"""Server-side ledger policy — the rules the model never applies (prompt spec
§5; data contract §1 supersede chain / §4 supersede semantics; test plan lines
17, 22, 23).

This is where generated facts *enter the project* on beat accept (T2.2). The
extraction op returns candidate facts and contradictions; this module decides
their `provenance`/`status`, verifies their verbatim `sourceText`, and turns
each contradiction into a **supersede proposal** without ever touching the
fact it supersedes. Pure: no DB, no LLM, no logging (hard rule 5 — this module
logs nothing).

Policy (§5):
  - `provenance` is always `inferred` (server-assigned; the model never sets it).
  - `confidence >= 0.8` → `active`; below the floor → `pending_review`
    (excluded from prompt bundles by `ledger_filter.is_prompt_eligible_fact`).
  - A non-empty `sourceText` that is *not* found verbatim within its reported
    line range is demoted to `pending_review` regardless of confidence
    (offset verification, §5 / test plan line 23).
  - Each contradiction → a new `pending_review` fact with `supersedes` set to
    the existing fact's id; the existing fact keeps `status: active` and its
    `supersededBy` stays null until the writer confirms (§4). No overwrite.
  - Only **active** facts may be supersede targets at mint time (non-active
    targets are dropped — confirm-time `CONFLICT_STALE_PROPOSAL` remains).
  - Null `proposedReplacement` → **stored-null**: proposal `fact` is `""`
    (retirement marker). Confirm of an empty-fact supersede proposal retires
    the target without activating a replacement (data contract §4).
"""

from __future__ import annotations

import html
import re
import uuid
from bisect import bisect_left, bisect_right

from schemas import LedgerExtraction

CONFIDENCE_FLOOR = 0.8


class IdMinter:
    """Mints globally unique kebab ids (`fact-<hex>`, `flag-<hex>`).

    Avoids cross-project collisions on the `ledger_facts` / `consistency_flags`
    primary keys (those tables key by `id` alone, matching `/ledger/{factId}`).
    Skips any id already present in `existing_ids`.
    """

    def __init__(self, existing_ids: list[str], prefix: str, width: int = 2) -> None:
        del width  # retained for call-site compatibility; minting is no longer ordinal
        self._used = set(existing_ids)
        self._prefix = prefix

    def mint(self) -> str:
        while True:
            candidate = f"{self._prefix}{uuid.uuid4().hex[:12]}"
            if candidate not in self._used:
                self._used.add(candidate)
                return candidate


# Typographic variants that mean the same character but break an exact match.
# Imported scripts — OCR'd PDFs especially — are full of curly quotes and long
# dashes, while a model quoting them back usually normalizes to ASCII. On a
# real 60-page import this alone accounted for 61 of 120 facts failing
# verification and being demoted, every one of them genuinely on the page.
#
# **Every entry must be a single character mapping to a single character.**
# `verify_source_text` returns offsets into the ORIGINAL `script_text`, so the
# fold has to preserve length and position exactly — index i in the folded
# string must be index i in the original. That rules out things like
# "…" -> "..." (1 char to 3), which is why the ellipsis case is handled by
# asking the model for a contiguous quote instead (prompt spec §5).
_TYPOGRAPHIC_FOLD = str.maketrans(
    {
        "‘": "'",  # ' left single
        "’": "'",  # ' right single / apostrophe
        "‚": "'",  # ‚ low single
        "′": "'",  # ′ prime
        "´": "'",  # ´ acute
        "`": "'",  # ` backtick
        "“": '"',  # " left double
        "”": '"',  # " right double
        "„": '"',  # „ low double
        "″": '"',  # ″ double prime
        "–": "-",  # – en dash
        "—": "-",  # — em dash
        "−": "-",  # − minus
        " ": " ",  # non-breaking space
    }
)


def _fold_typography(text: str) -> str:
    """Length-preserving normalization — see `_TYPOGRAPHIC_FOLD`."""
    return text.translate(_TYPOGRAPHIC_FOLD)


def _line_window(script_text: str, start_line: int, end_line: int) -> tuple[int, int] | None:
    """Character range of 1-based inclusive lines ``start_line..end_line``
    (end excludes line ``end_line``'s ``"\n"``), or None when out of range."""
    lines = script_text.split("\n")
    lo, hi = start_line - 1, end_line - 1
    if not 0 <= lo <= hi < len(lines):
        return None
    window_start = sum(len(line) + 1 for line in lines[:lo])
    return window_start, window_start + len("\n".join(lines[lo : hi + 1]))


def verify_source_text(
    script_text: str, source_text: str, start_line: int, end_line: int
) -> tuple[int | None, int | None, bool]:
    """Strict §5 verification: locate ``source_text`` verbatim **within the
    reported line window only** (no whole-beat fallback — a wrong line range is
    itself a low-trust signal; the line range also disambiguates a quote that
    occurs twice). Returns ``(char_start, char_end, verified)``:

      - empty ``source_text`` → ``(None, None, True)``: nothing to verify (a
        fact may have no verbatim anchor), never a demotion.
      - found in window → ``(start, end, True)`` where
        ``script_text[start:end] == source_text`` exactly.
      - non-empty but absent from the window → ``(None, None, False)``: the
        caller demotes to ``pending_review`` (test plan line 23)."""
    if not source_text:
        return (None, None, True)
    window = _line_window(script_text, start_line, end_line)
    if window is not None:
        window_start, window_end = window
        # Fold both sides so a curly apostrophe on the page still matches a
        # straight one in the quote. The fold is length-preserving, so `idx`
        # and the slice below index the ORIGINAL script_text — the caller
        # stores these offsets and the Ledger highlights the real characters.
        idx = _fold_typography(script_text).find(
            _fold_typography(source_text), window_start, window_end
        )
        if idx != -1:
            return (idx, idx + len(source_text), True)
    return (None, None, False)


# html.unescape's own reference pattern, so each reference is unescaped in
# place and keeps its span in the original text.
_HTML_REF = re.compile(r"&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[^\t\n\f <&#;]{1,32};?)")
# Whole lines a page break leaves inside dialogue: page numbers, CONTINUED
# (OCR-mangled variants included), (MORE) and CONT'D cues. Matched against the
# folded, stripped line.
_PAGE_FURNITURE = re.compile(
    r"\d+[A-Z]?\.?|\(MORE\)|[^a-z]*\(CONT'?D\)|.{0,12}\bCONTINUED\b.{0,16}"
)


def _match_view(text: str, skip_furniture: bool) -> tuple[str, list[int], list[int]]:
    """``text`` as `locate_quote` compares it (HTML references unescaped,
    typography folded, whitespace runs collapsed to one space, page-furniture
    lines dropped when ``skip_furniture``), plus each view character's
    ``[start, end)`` span in ``text``."""
    view: list[str] = []
    starts: list[int] = []
    ends: list[int] = []
    line_start = 0
    for line in text.split("\n"):
        line_end = line_start + len(line)
        if not (skip_furniture and _PAGE_FURNITURE.fullmatch(_fold_typography(line).strip())):
            pieces: list[tuple[int, int, str]] = []
            pos = line_start
            for ref in _HTML_REF.finditer(text, line_start, line_end):
                unescaped = html.unescape(ref.group(0))
                if unescaped != ref.group(0):
                    pieces += [(i, i + 1, text[i]) for i in range(pos, ref.start())]
                    pieces.append((ref.start(), ref.end(), unescaped))
                    pos = ref.end()
            pieces += [(i, i + 1, text[i]) for i in range(pos, line_end)]
            pieces.append((line_end, line_end + 1, " "))  # the line break
            for start, end, chunk in pieces:
                for char in _fold_typography(chunk):
                    if char.isspace():
                        if view[-1:] == [" "]:
                            continue
                        char = " "
                    view.append(char)
                    starts.append(start)
                    ends.append(end)
        line_start = line_end + 1
    return "".join(view), starts, ends


def locate_quote(
    script_text: str, source_text: str, start_line: int, end_line: int
) -> tuple[int | None, int | None]:
    """Import offsets for ``source_text`` within a beat's ``script_text``.
    Verbatim first (reported line window, then whole beat, typography folded:
    the offsets `verify_source_text` gives), then through `_match_view`'s
    normalization, first keeping page furniture and then skipping it, so a cue
    or number line the quote itself contains is never dropped. Returns
    ``(char_start, char_end)`` into the original ``script_text``, or
    ``(None, None)`` when the quote is empty or not on the page. Offsets only:
    activation is `verify_source_text`'s call alone."""
    if not source_text:
        return (None, None)
    start, end, _ = verify_source_text(script_text, source_text, start_line, end_line)
    if start is not None:
        return (start, end)
    idx = _fold_typography(script_text).find(_fold_typography(source_text))
    if idx != -1:
        return (idx, idx + len(source_text))
    window = _line_window(script_text, start_line, end_line)
    for skip_furniture in (False, True):
        quote = _match_view(source_text, skip_furniture)[0].strip()
        if not quote:
            continue
        view, starts, ends = _match_view(script_text, skip_furniture)
        idx = -1
        if window is not None:
            idx = view.find(quote, bisect_left(starts, window[0]), bisect_right(ends, window[1]))
        if idx == -1:
            idx = view.find(quote)
        if idx != -1:
            return (starts[idx], ends[idx + len(quote) - 1])
    return (None, None)


def apply_extraction_policy(
    extraction: LedgerExtraction,
    *,
    existing_ledger: list[dict],
    accepted_beat: dict,
    episode_id: str,
    scene_id: str,
) -> tuple[list[dict], list[dict], list[dict]]:
    """Apply the §5 server policy to a raw `LedgerExtraction`, returning
    ``(new_facts, proposals, contradictions)`` — all camelCase `LedgerFact`
    wire dicts (facts/proposals) or response records (contradictions):

      - ``new_facts``: extracted facts, `inferred`, with server-computed char
        offsets and status by the confidence + sourceText policy above. Their
        `sourceSpan` target (episode/scene/beat) is forced to the accepted beat
        — the extraction is scoped to that beat's delta, so the model's own ids
        are not trusted.
      - ``proposals``: one supersede proposal per contradiction whose target
        fact exists in ``existing_ledger`` (a target that isn't present is
        dropped — you cannot supersede a fact that isn't there). Each is a new
        `pending_review` fact carrying `supersedes`.
      - ``contradictions``: ``{existingFactId, explanation, proposedReplacement,
        proposalId}`` records for the accept response.

    Never mutates ``existing_ledger`` or any fact in it (no overwrite)."""
    minter = IdMinter([f["id"] for f in existing_ledger], "fact-")
    span_target = {
        "episodeId": episode_id,
        "sceneId": scene_id,
        "beatId": accepted_beat["id"],
    }
    script = accepted_beat.get("scriptText", "")

    new_facts: list[dict] = []
    for extracted in extraction.new_facts:
        dump = extracted.model_dump(by_alias=True, mode="json")
        span = dump["sourceSpan"]
        char_start, char_end, verified = verify_source_text(
            script, dump["sourceText"], span["startLine"], span["endLine"]
        )
        active = dump["confidence"] >= CONFIDENCE_FLOOR and verified
        new_facts.append(
            {
                "id": minter.mint(),
                "fact": dump["fact"],
                "factType": dump["factType"],
                "sourceSpan": {
                    **span_target,
                    "startLine": span["startLine"],
                    "endLine": span["endLine"],
                    "charStart": char_start,
                    "charEnd": char_end,
                },
                "sourceText": dump["sourceText"],
                "knownBy": dump["knownBy"],
                "audienceKnows": dump["audienceKnows"],
                "provenance": "inferred",
                "confidence": dump["confidence"],
                "status": "active" if active else "pending_review",
                "supersedes": None,
                "supersededBy": None,
            }
        )

    by_id = {f["id"]: f for f in existing_ledger}
    proposals: list[dict] = []
    contradictions: list[dict] = []
    for contradiction in extraction.contradictions:
        record = contradiction.model_dump(by_alias=True, mode="json")
        target = by_id.get(record["existingFactId"])
        if target is None:
            continue  # can't supersede a fact that isn't in the ledger
        if target.get("status") != "active":
            continue  # creation-time guard: only active targets
        proposal_id = minter.mint()
        replacement = record["proposedReplacement"]
        # Stored-null retirement marker: null proposedReplacement → empty fact.
        # Confirm detects retirement via empty proposal.fact (not text-equality).
        fact_text = "" if replacement is None else replacement
        proposals.append(
            {
                "id": proposal_id,
                "fact": fact_text,
                "factType": target["factType"],
                "sourceSpan": {
                    **span_target,
                    "startLine": None,
                    "endLine": None,
                    "charStart": None,
                    "charEnd": None,
                },
                "sourceText": "",
                "knownBy": target["knownBy"],
                "audienceKnows": target["audienceKnows"],
                "provenance": "inferred",
                "confidence": target["confidence"],
                "status": "pending_review",
                "supersedes": record["existingFactId"],
                "supersededBy": None,
            }
        )
        contradictions.append(
            {
                "existingFactId": record["existingFactId"],
                "explanation": record["explanation"],
                "proposedReplacement": record["proposedReplacement"],
                "proposalId": proposal_id,
            }
        )

    return new_facts, proposals, contradictions
