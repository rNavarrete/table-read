"""Deterministic Fountain parsing — stage 1 of the two-stage import parse
(docs/tableread-prompt-spec.md §7). **The LLM never controls text coverage**
(§7 header): this module owns the scene split and the server-side line-range
validation that guarantees 100% of the source is preserved.

Everything here is pure and deterministic (no LLM, no DB). The byte-identity
guarantee (T1.3 acceptance) rests on one invariant: the source is a list of
lines (`source.split("\n")`), every line has exactly one owner (a beat, with
unassigned ranges merged into the nearest beat), and reconstruction is
`"\n".join` over the owners in order — which is `"\n".join(source.split("\n"))`,
i.e. the original source byte-for-byte (`\r` in CRLF endings rides along as
trailing line content; a trailing "" from a final newline is its own line and
is preserved).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from schemas import SegmentedScene

# Fountain scene heading (slugline): a line beginning (after optional leading
# whitespace) with a standard set/interior prefix. Case-insensitive per the
# Fountain spec. Forced headings ("." prefix) and the blank-line-before rule
# are out of MVP scope — export never emits either, and importers of hand
# authored Fountain get the common prefixes. See the task report.
_SLUGLINE_RE = re.compile(
    r"^\s*(INT\./EXT\.?|INT/EXT\.?|I/E\.?|INT\.?|EXT\.?|EST\.?)[\s.]", re.IGNORECASE
)


class CoverageError(ValueError):
    """Stage-2 segmentation failed the server-side coverage check (§7): the
    beats + unassigned ranges do not tile the scene's lines exactly (a gap,
    an overlap, or an out-of-bounds range). The import route maps this to the
    contract's `VALIDATION` error and persists nothing."""


@dataclass(frozen=True)
class SceneSpan:
    """One scene from the deterministic split: its slugline text (``""`` for
    a pre-slugline front-matter bucket) and the exact source lines it owns."""

    location: str
    lines: list[str]  # the scene's own source lines, in order
    start_line: int  # 0-based index of this scene's first line in the full source


@dataclass
class ImportedBeat:
    """A final beat after coverage validation + unassigned merge. ``script_text``
    is sliced verbatim from the source (never model-authored). ``unassigned``
    holds absolute source line ranges (1-based, inclusive) that were merged
    into this beat and must be surfaced as review flags."""

    what_happens: str
    audience_learns: str
    audience_feels: str
    script_text: str
    unassigned: list[tuple[int, int]] = field(default_factory=list)


def is_slugline(line: str) -> bool:
    return bool(_SLUGLINE_RE.match(line))


def split_into_scenes(source: str) -> list[SceneSpan]:
    """Stage 1: split source into ordered scenes, each owning an exact line
    range (§7). 100% of lines belong to exactly one scene; pre-slugline
    material becomes a leading front-matter bucket (``location=""``)."""
    lines = source.split("\n")
    slug_indices = [i for i, line in enumerate(lines) if is_slugline(line)]

    if not slug_indices:
        # No sluglines at all: the whole document is one front-matter bucket.
        return [SceneSpan(location="", lines=lines, start_line=0)]

    scenes: list[SceneSpan] = []
    first = slug_indices[0]
    if first > 0:
        scenes.append(SceneSpan(location="", lines=lines[:first], start_line=0))

    for pos, start in enumerate(slug_indices):
        end = slug_indices[pos + 1] if pos + 1 < len(slug_indices) else len(lines)
        scenes.append(
            SceneSpan(
                location=lines[start].strip(),
                lines=lines[start:end],
                start_line=start,
            )
        )
    return scenes


def validate_and_slice(scene: SceneSpan, segmented: SegmentedScene) -> list[ImportedBeat]:
    """Stage-2 server-side validation + slicing (§7). Verifies the model's beat
    + unassigned line ranges tile the scene exactly (1..K, ordered, no gaps,
    no overlaps), then slices each beat's ``scriptText`` verbatim from the
    source and merges every unassigned range into the nearest beat so no line
    is ever dropped. Raises ``CoverageError`` on any coverage failure."""
    k = len(scene.lines)

    # Gather every claimed range, tagged with whether it is a real beat.
    Claim = tuple[int, int, bool, object]  # (start, end, is_beat, payload)
    claims: list[Claim] = []
    for beat in segmented.beats:
        claims.append((beat.start_line, beat.end_line, True, beat))
    for un in segmented.unassigned:
        claims.append((un.start_line, un.end_line, False, un))

    if not claims:
        raise CoverageError(
            f"segmentation covered no lines but the scene has {k} line(s)"
        )

    claims.sort(key=lambda c: (c[0], c[1]))

    # Contiguity / bounds check: sorted ranges must start at 1, end at K, and
    # each range must begin exactly one line after the previous one ended.
    cursor = 1
    for start, end, _is_beat, _payload in claims:
        if start < 1 or end < start or end > k:
            raise CoverageError(
                f"range {start}-{end} is out of bounds for a {k}-line scene"
            )
        if start != cursor:
            if start > cursor:
                raise CoverageError(f"gap: lines {cursor}-{start - 1} are uncovered")
            raise CoverageError(f"overlap at line {start} (expected {cursor})")
        cursor = end + 1
    if cursor != k + 1:
        raise CoverageError(f"gap: lines {cursor}-{k} are uncovered")

    return _merge(scene, claims)


def reconstruct(scenes_beats: list[list[ImportedBeat]]) -> str:
    """Byte-identity proof (T1.3 acceptance): concatenate every beat's verbatim
    ``scriptText`` (unassigned runs already merged in), in scene then beat
    order. Because the beats are a gapless, ordered partition of the source's
    lines, this is ``"\n".join(source.split("\n"))`` — the original source
    byte-for-byte."""
    return "\n".join(beat.script_text for beats in scenes_beats for beat in beats)


def locate_source_text(
    script_text: str, source_text: str, start_line: int, end_line: int
) -> tuple[int | None, int | None]:
    """§5 offset verification: locate ``source_text`` verbatim within the beat's
    ``scriptText``, preferring the model-reported line window (1-based, inclusive;
    disambiguates a quote that occurs twice), and return character offsets into
    ``scriptText``. Returns ``(None, None)`` when the quote is empty or absent —
    the caller leaves offsets null (import facts are ``pending_review`` regardless)."""
    if not source_text:
        return (None, None)
    lines = script_text.split("\n")
    offsets: list[int] = []
    acc = 0
    for line in lines:
        offsets.append(acc)
        acc += len(line) + 1  # +1 for the joining "\n"

    lo, hi = start_line - 1, end_line - 1
    if 0 <= lo <= hi < len(lines):
        window_start = offsets[lo]
        window_end = offsets[hi] + len(lines[hi])  # end of line hi (before its "\n")
        idx = script_text.find(source_text, window_start, window_end)
        if idx != -1:
            return (idx, idx + len(source_text))
    idx = script_text.find(source_text)  # fall back to anywhere in the beat
    return (idx, idx + len(source_text)) if idx != -1 else (None, None)


@dataclass
class _FinalBeat:
    start: int  # 1-based, inclusive, within the scene
    end: int
    what_happens: str
    audience_learns: str
    audience_feels: str
    unassigned: list[tuple[int, int]] = field(default_factory=list)  # 1-based scene ranges


def _merge(scene: SceneSpan, claims: list) -> list[ImportedBeat]:
    """Turn validated, tiling claims into final beats: each model beat anchors
    a final beat; unassigned ranges attach to the nearest beat (the preceding
    one, or the following one if they lead the scene). A scene whose model
    output was entirely unassigned yields a single synthetic beat holding all
    the text, wholly flagged — text is never dropped. Because the claims tile
    the scene contiguously, growing a beat's ``end`` to swallow a following
    unassigned run (or its ``start`` to swallow a leading one) keeps the final
    beats a gapless partition of 1..K, so reconstruction stays byte-identical."""
    finals: list[_FinalBeat] = []
    pending_lead: list[tuple[int, int]] = []  # unassigned runs before the first beat

    for start, end, is_beat, payload in claims:
        if is_beat:
            fb = _FinalBeat(
                start=start,
                end=end,
                what_happens=payload.what_happens,
                audience_learns=payload.audience_learns,
                audience_feels=payload.audience_feels,
            )
            if pending_lead:
                fb.start = pending_lead[0][0]  # absorb leading unassigned runs
                fb.unassigned.extend(pending_lead)
                pending_lead = []
            finals.append(fb)
        elif finals:
            current = finals[-1]  # extend the preceding beat to swallow this run
            current.end = end
            current.unassigned.append((start, end))
        else:
            pending_lead.append((start, end))

    if not finals:
        # Entire scene was unassigned: synthesize one beat holding everything.
        finals.append(
            _FinalBeat(
                start=1,
                end=len(scene.lines),
                what_happens="",
                audience_learns="",
                audience_feels="",
                unassigned=[(s, e) for s, e, _b, _p in claims],
            )
        )

    abs_start = scene.start_line  # source-wide offset for flag line numbers
    return [
        ImportedBeat(
            what_happens=fb.what_happens,
            audience_learns=fb.audience_learns,
            audience_feels=fb.audience_feels,
            script_text="\n".join(scene.lines[fb.start - 1 : fb.end]),
            unassigned=[(abs_start + s, abs_start + e) for s, e in fb.unassigned],
        )
        for fb in finals
    ]
