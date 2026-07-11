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

import uuid

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
    lines = script_text.split("\n")
    offsets: list[int] = []
    acc = 0
    for line in lines:
        offsets.append(acc)
        acc += len(line) + 1  # +1 for the joining "\n"
    lo, hi = start_line - 1, end_line - 1
    if 0 <= lo <= hi < len(lines):
        window_start = offsets[lo]
        window_end = offsets[hi] + len(lines[hi])  # end of line hi, before its "\n"
        idx = script_text.find(source_text, window_start, window_end)
        if idx != -1:
            return (idx, idx + len(source_text), True)
    return (None, None, False)


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
