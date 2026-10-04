"""Deterministic Fountain parsing — stage 1 of the two-stage import parse
(docs/tableread-prompt-spec.md §7). **The LLM never controls text coverage**
(§7 header): this module owns the scene split and turns untrusted model-proposed
segment starts into a deterministic partition that preserves 100% of the source.

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

from schemas import SegmentedScene, SegmentedSceneBeat, SegmentedSceneUnassigned

# Fountain scene heading (slugline): a line beginning (after optional leading
# whitespace and an optional production scene number, "17 " / "A12 ") with a
# standard set/interior prefix, or a forced heading (one "." then a non-".",
# so "..." stays an ellipsis). A mixed-case prefix ("Int. Kitchen - Day") is
# a heading only when the next word is not lowercase: "Ext. is short for
# exterior." is action prose. The blank-line-before rule is out of MVP scope.
_HEADING_PREFIX = r"INT\./EXT|INT/EXT|EXT\./INT|EXT/INT|I/E|INT|EXT|EST"
_SLUGLINE_RE = re.compile(
    r"^\s*(?:(?:[A-Za-z]?\d+[A-Za-z]?\s+)?"
    rf"(?:(?:{_HEADING_PREFIX}|{_HEADING_PREFIX.lower()})[\s.]"
    rf"|(?i:{_HEADING_PREFIX})[\s.](?!\s*[a-z]))"
    r"|\.[^.\s])"
)


class CoverageError(ValueError):
    """The deterministic source partition cannot be constructed at all.

    Model-proposed segment starts never raise this error: they are normalized
    into a complete partition and flagged. The import route still uses this
    error for source-level failures such as empty import content.
    """


@dataclass(frozen=True)
class FrontMatterStrip:
    content: str
    removed_line_count: int
    removed_char_count: int


@dataclass(frozen=True)
class SceneSpan:
    """One scene from the deterministic split: its slugline text (``""`` for
    a pre-slugline front-matter bucket) and the exact source lines it owns."""

    location: str
    lines: list[str]  # the scene's own source lines, in order
    start_line: int  # 0-based index of this scene's first line in the full source


@dataclass
class ImportedBeat:
    """A final beat after segment-start normalization and unassigned merge."""

    what_happens: str
    audience_learns: str
    audience_feels: str
    script_text: str
    unassigned: list[tuple[int, int]] = field(default_factory=list)
    review_issues: list[SegmentationIssue] = field(default_factory=list)


@dataclass(frozen=True)
class SegmentationIssue:
    """Stable, content-free provenance for a selected normalization repair.

    Line ranges are source-wide and 1-based once attached to an ImportedBeat.
    ``model_start`` remains scene-local because it may be outside the source.
    """

    code: str
    start_line: int | None = None
    end_line: int | None = None
    model_start: int | None = None
    discarded_beat_metadata: int = 0
    boundary_displacement: int = 0


@dataclass(frozen=True)
class RepairScore:
    """Lexicographic quality score; lower is better."""

    discarded_beat_metadata: int
    affected_lines: int
    max_boundary_displacement: int
    event_count: int

    def ranking_key(self) -> tuple[int, int, int, int]:
        return (
            self.discarded_beat_metadata,
            self.affected_lines,
            self.max_boundary_displacement,
            self.event_count,
        )


@dataclass(frozen=True)
class NormalizedScene:
    beats: list[ImportedBeat]
    score: RepairScore
    repair_ratio: float
    empty_output: bool
    duplicate_start: bool
    diagnostics: list[dict]

    @property
    def should_retry(self) -> bool:
        return (
            self.empty_output
            or self.duplicate_start
            or self.score.discarded_beat_metadata > 0
            or self.repair_ratio > 0.05
        )


def is_slugline(line: str) -> bool:
    return bool(_SLUGLINE_RE.match(line))


_TITLE_PAGE_FIELD_RE = re.compile(
    r"^\s*(title|credit|author|authors|source|draft date|date|contact|copyright)\s*:",
    re.IGNORECASE,
)
_FRONT_MATTER_SIGNAL_RE = re.compile(
    r"^\s*(cast|cast list|sets|set list|locations|location list|written by|final draft)\s*:?\s*$",
    re.IGNORECASE,
)
_FADE_IN_RE = re.compile(r"^\s*fade\s+in\s*[:.]?\s*$", re.IGNORECASE)


def _strip_result(
    source: str, retained_lines: list[str], removed_lines: list[str]
) -> FrontMatterStrip:
    while retained_lines and not retained_lines[0].strip():
        removed_lines.append(retained_lines.pop(0))
    content = "\n".join(retained_lines)
    return FrontMatterStrip(
        content=content,
        removed_line_count=len(removed_lines),
        removed_char_count=max(0, len(source) - len(content)),
    )


def strip_screenplay_front_matter(source: str) -> FrontMatterStrip:
    """Remove production metadata before deterministic scene ownership begins.

    The filter intentionally requires a structural boundary rather than trying
    to understand arbitrary prose. An opening FADE IN is safe when it precedes
    the first slugline, or when title/cast/set signals explain any slugline-like
    entries before it. Without FADE IN, only a recognized Fountain title-page
    prefix is removed.
    """
    lines = source.split("\n")
    fade_index = next(
        (index for index, line in enumerate(lines[:500]) if _FADE_IN_RE.match(line)),
        None,
    )
    if fade_index is not None and any(line.strip() for line in lines[fade_index + 1 :]):
        prefix = lines[: fade_index + 1]
        slug_before_fade = any(is_slugline(line) for line in prefix)
        metadata_signal = any(
            _TITLE_PAGE_FIELD_RE.match(line) or _FRONT_MATTER_SIGNAL_RE.match(line)
            for line in prefix
        )
        if not slug_before_fade or metadata_signal:
            return _strip_result(source, lines[fade_index + 1 :], prefix)

    first_slug = next((index for index, line in enumerate(lines) if is_slugline(line)), None)
    if first_slug is not None and first_slug > 0:
        prefix = lines[:first_slug]
        meaningful = [line for line in prefix if line.strip()]
        if meaningful and all(
            _TITLE_PAGE_FIELD_RE.match(line) or line[:1].isspace() for line in meaningful
        ):
            return _strip_result(source, lines[first_slug:], prefix)

    return FrontMatterStrip(content=source, removed_line_count=0, removed_char_count=0)


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


def normalize_and_slice(scene: SceneSpan, segmented: SegmentedScene) -> NormalizedScene:
    """Normalize typed segment starts into a total, ordered partition of 1..K.

    The model supplies only starts. The server sorts whole segment objects,
    derives every end from the next start, converts duplicate starts to an
    unassigned segment, discards out-of-bounds starts, and synthesizes an
    unassigned prefix or whole-scene segment when needed. Every selected repair
    is retained as a review issue; no schema-valid segmentation can drop or
    duplicate source text.
    """
    k = len(scene.lines)
    raw = list(segmented.segments)
    empty_output = not raw
    pending_issues: list[SegmentationIssue] = []

    valid = [segment for segment in raw if segment.start_line <= k]
    if [s.start_line for s in valid] != sorted(s.start_line for s in valid):
        pending_issues.append(SegmentationIssue(code="unordered_segments"))

    for segment in raw:
        if segment.start_line > k:
            discarded = int(isinstance(segment, SegmentedSceneBeat))
            pending_issues.append(
                SegmentationIssue(
                    code="out_of_bounds_start",
                    model_start=segment.start_line,
                    discarded_beat_metadata=discarded,
                    boundary_displacement=segment.start_line - k,
                )
            )

    groups: dict[int, list[SegmentedSceneBeat | SegmentedSceneUnassigned]] = {}
    for segment in valid:
        groups.setdefault(segment.start_line, []).append(segment)

    # (start, payload, review-code, discarded-beat-metadata)
    canonical: list[
        tuple[int, SegmentedSceneBeat | SegmentedSceneUnassigned, str | None, int]
    ] = []
    duplicate_start = False
    for start in sorted(groups):
        group = groups[start]
        if len(group) == 1:
            payload = group[0]
            code = "model_unassigned" if isinstance(payload, SegmentedSceneUnassigned) else None
            canonical.append((start, payload, code, 0))
            continue
        duplicate_start = True
        discarded = sum(isinstance(item, SegmentedSceneBeat) for item in group)
        canonical.append(
            (
                start,
                SegmentedSceneUnassigned(
                    kind="unassigned", start_line=start, reason="duplicate_start"
                ),
                "duplicate_start",
                discarded,
            )
        )

    missing_initial_displacement = 0
    if not canonical:
        code = "empty_output" if empty_output else "no_valid_segments"
        canonical.append(
            (
                1,
                SegmentedSceneUnassigned(kind="unassigned", start_line=1, reason=code),
                code,
                0,
            )
        )
    elif canonical[0][0] > 1:
        first = canonical[0][0]
        missing_initial_displacement = first - 1
        canonical.insert(
            0,
            (
                1,
                SegmentedSceneUnassigned(
                    kind="unassigned", start_line=1, reason="missing_initial_start"
                ),
                "missing_initial_start",
                0,
            ),
        )

    claims: list[_Claim] = []
    for index, (start, payload, code, discarded) in enumerate(canonical):
        end = canonical[index + 1][0] - 1 if index + 1 < len(canonical) else k
        issues: list[SegmentationIssue] = []
        if code is not None:
            issues.append(
                SegmentationIssue(
                    code=code,
                    start_line=start,
                    end_line=end,
                    model_start=start,
                    discarded_beat_metadata=discarded,
                    boundary_displacement=(
                        missing_initial_displacement
                        if code == "missing_initial_start"
                        else 0
                    ),
                )
            )
        claims.append(
            _Claim(
                start=start,
                end=end,
                is_beat=isinstance(payload, SegmentedSceneBeat),
                payload=payload,
                issues=issues,
            )
        )

    # Global repairs without an owned in-bounds range attach to a deterministic
    # beat for review: ordering to the first claim, high OOB starts to the last.
    for issue in pending_issues:
        target = claims[-1] if issue.code == "out_of_bounds_start" else claims[0]
        target.issues.append(issue)

    repairs = [
        issue
        for claim in claims
        for issue in claim.issues
        if issue.code != "model_unassigned"
    ]
    affected_lines = _covered_line_count(
        [(issue.start_line, issue.end_line) for issue in repairs]
    )
    score = RepairScore(
        discarded_beat_metadata=sum(issue.discarded_beat_metadata for issue in repairs),
        affected_lines=affected_lines,
        max_boundary_displacement=max(
            (issue.boundary_displacement for issue in repairs), default=0
        ),
        event_count=len(repairs),
    )
    diagnostics = [
        {
            "code": issue.code,
            "startLine": issue.start_line,
            "endLine": issue.end_line,
            "modelStart": issue.model_start,
            "discardedBeatMetadata": issue.discarded_beat_metadata,
        }
        for issue in repairs
    ]
    return NormalizedScene(
        beats=_merge(scene, claims),
        score=score,
        repair_ratio=affected_lines / k,
        empty_output=empty_output,
        duplicate_start=duplicate_start,
        diagnostics=diagnostics,
    )


def validate_and_slice(scene: SceneSpan, segmented: SegmentedScene) -> list[ImportedBeat]:
    """Compatibility wrapper for the pure parser tests and non-retrying callers."""
    return normalize_and_slice(scene, segmented).beats


def _covered_line_count(ranges: list[tuple[int | None, int | None]]) -> int:
    """Size of the union of valid inclusive ranges without allocating per line."""
    concrete = sorted(
        (start, end)
        for start, end in ranges
        if start is not None and end is not None
    )
    if not concrete:
        return 0
    total = 0
    current_start, current_end = concrete[0]
    for start, end in concrete[1:]:
        if start <= current_end + 1:
            current_end = max(current_end, end)
        else:
            total += current_end - current_start + 1
            current_start, current_end = start, end
    return total + current_end - current_start + 1


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
    review_issues: list[SegmentationIssue] = field(default_factory=list)


@dataclass
class _Claim:
    start: int
    end: int
    is_beat: bool
    payload: SegmentedSceneBeat | SegmentedSceneUnassigned
    issues: list[SegmentationIssue] = field(default_factory=list)


def _merge(scene: SceneSpan, claims: list[_Claim]) -> list[ImportedBeat]:
    """Turn the derived partition into final beats: each model beat anchors
    a final beat; unassigned ranges attach to the nearest beat (the preceding
    one, or the following one if they lead the scene). A scene whose model
    output was entirely unassigned yields a single synthetic beat holding all
    the text, wholly flagged — text is never dropped. Because the claims tile
    the scene contiguously, growing a beat's ``end`` to swallow a following
    unassigned run (or its ``start`` to swallow a leading one) keeps the final
    beats a gapless partition of 1..K, so reconstruction stays byte-identical."""
    finals: list[_FinalBeat] = []
    pending_lead: list[_Claim] = []  # unassigned runs before the first beat

    for claim in claims:
        if claim.is_beat:
            fb = _FinalBeat(
                start=claim.start,
                end=claim.end,
                what_happens=claim.payload.what_happens,
                audience_learns=claim.payload.audience_learns,
                audience_feels=claim.payload.audience_feels,
                review_issues=list(claim.issues),
            )
            if pending_lead:
                fb.start = pending_lead[0].start  # absorb leading unassigned runs
                fb.unassigned.extend((item.start, item.end) for item in pending_lead)
                fb.review_issues.extend(
                    issue for item in pending_lead for issue in item.issues
                )
                pending_lead = []
            finals.append(fb)
        elif finals:
            current = finals[-1]  # extend the preceding beat to swallow this run
            current.end = claim.end
            current.unassigned.append((claim.start, claim.end))
            current.review_issues.extend(claim.issues)
        else:
            pending_lead.append(claim)

    if not finals:
        # Entire scene was unassigned: synthesize one beat holding everything.
        #
        # This is a real failure of the operation, not a tidy fallback. The
        # scene keeps all its text (coverage is never at risk) but loses its
        # whole semantic layer, and everything downstream that reads the beat
        # spine — entity summaries, narrative promises, the story overview —
        # silently receives empty strings. Every real import to date landed
        # here for every scene without emitting a single signal, so the
        # synthetic beat now always carries its own flag.
        finals.append(
            _FinalBeat(
                start=1,
                end=len(scene.lines),
                what_happens="",
                audience_learns="",
                audience_feels="",
                unassigned=[(claim.start, claim.end) for claim in claims],
                review_issues=[
                    SegmentationIssue(
                        code="no_beats_returned",
                        start_line=1,
                        end_line=len(scene.lines),
                    ),
                    # Every claim here is unassigned, so each would otherwise add
                    # a "review the boundary" flag — pointing at a boundary that
                    # does not exist and burying the one flag that names the real
                    # failure. Other codes still carry information (discarded
                    # metadata, out-of-range starts) and are kept.
                    *(
                        issue
                        for claim in claims
                        for issue in claim.issues
                        if issue.code != "model_unassigned"
                    ),
                ],
            )
        )

    # A beat that came back with no semantic content is the same failure in a
    # quieter form: the partition is fine, but the beat says nothing. Flag it
    # rather than let an empty whatHappens pass for analysis. The synthetic
    # beat above is empty by construction and already carries its own code —
    # flagging it twice would just double the noise for one problem.
    for fb in finals:
        if any(issue.code == "no_beats_returned" for issue in fb.review_issues):
            continue
        if not (fb.what_happens or "").strip():
            fb.review_issues.append(
                SegmentationIssue(
                    code="empty_beat_fields",
                    start_line=fb.start,
                    end_line=fb.end,
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
            review_issues=[
                SegmentationIssue(
                    code=issue.code,
                    start_line=(
                        abs_start + issue.start_line
                        if issue.start_line is not None
                        else None
                    ),
                    end_line=(
                        abs_start + issue.end_line
                        if issue.end_line is not None
                        else None
                    ),
                    model_start=issue.model_start,
                    discarded_beat_metadata=issue.discarded_beat_metadata,
                    boundary_displacement=issue.boundary_displacement,
                )
                for issue in fb.review_issues
            ],
        )
        for fb in finals
    ]
