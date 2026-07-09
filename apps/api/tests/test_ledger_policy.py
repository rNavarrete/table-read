"""Unit tests for the server-side ledger policy (prompt spec §5; test plan
lines 17, 22, 23). Pure functions — no DB, no LLM, no HTTP.
"""

from __future__ import annotations

from drama_manager import ledger_policy
from schemas import LedgerExtraction

BEAT = {
    "id": "beat-3-2",
    "scriptText": "INT. BAR - DAY\n\nReyes snaps the cuffs on Dan.\n\nDAN\nThis is a mistake.",
}


def _extraction(new_facts=None, contradictions=None) -> LedgerExtraction:
    return LedgerExtraction.model_validate(
        {"newFacts": new_facts or [], "contradictions": contradictions or []}
    )


def _fact(confidence=0.95, source_text="", start=1, end=1) -> dict:
    return {
        "fact": "Dan is arrested.",
        "factType": "event",
        "sourceSpan": {"episodeId": "ep-1", "sceneId": "scene-3", "beatId": "beat-3-2",
                       "startLine": start, "endLine": end},
        "sourceText": source_text,
        "knownBy": ["char-marta", "char-dan"],
        "audienceKnows": True,
        "confidence": confidence,
    }


def _apply(extraction, existing_ledger=None):
    return ledger_policy.apply_extraction_policy(
        extraction,
        existing_ledger=existing_ledger or [],
        accepted_beat=BEAT,
        episode_id="ep-1",
        scene_id="scene-3",
    )


# ── confidence gate (§5) ─────────────────────────────────────────────────────


def test_high_confidence_becomes_active():
    new_facts, _p, _c = _apply(_extraction([_fact(confidence=0.9)]))
    assert new_facts[0]["status"] == "active"
    assert new_facts[0]["provenance"] == "inferred"  # always server-assigned


def test_low_confidence_becomes_pending_review():
    new_facts, _p, _c = _apply(_extraction([_fact(confidence=0.5)]))
    assert new_facts[0]["status"] == "pending_review"
    assert new_facts[0]["provenance"] == "inferred"


def test_confidence_floor_is_inclusive():
    new_facts, _p, _c = _apply(_extraction([_fact(confidence=0.8)]))
    assert new_facts[0]["status"] == "active"  # >= 0.8


# ── sourceText verification (§5 / test plan line 23) ─────────────────────────


def test_sourcetext_found_in_window_sets_exact_offsets():
    # line 3 (1-based) is "Reyes snaps the cuffs on Dan."
    quote = "Reyes snaps the cuffs on Dan."
    new_facts, _p, _c = _apply(
        _extraction([_fact(confidence=0.95, source_text=quote, start=3, end=3)])
    )
    fact = new_facts[0]
    span = fact["sourceSpan"]
    assert fact["status"] == "active"  # verified + high confidence
    assert BEAT["scriptText"][span["charStart"]:span["charEnd"]] == quote  # reproduces exactly


def test_nonempty_sourcetext_absent_from_window_demotes():
    # high confidence, but the quote is not on the reported line -> demote
    new_facts, _p, _c = _apply(
        _extraction([_fact(confidence=0.99, source_text="Reyes snaps the cuffs on Dan.",
                           start=1, end=1)])
    )
    fact = new_facts[0]
    assert fact["status"] == "pending_review"  # demoted despite 0.99
    assert fact["sourceSpan"]["charStart"] is None


def test_empty_sourcetext_is_not_a_demotion():
    new_facts, _p, _c = _apply(_extraction([_fact(confidence=0.95, source_text="")]))
    assert new_facts[0]["status"] == "active"
    assert new_facts[0]["sourceSpan"]["charStart"] is None


def test_duplicate_quote_resolved_by_line_range():
    beat = {"id": "beat-3-2", "scriptText": "same line\nsame line"}
    quote = "same line"
    extraction = _extraction(
        [{
            "fact": "f", "factType": "event",
            "sourceSpan": {"episodeId": "ep-1", "sceneId": "scene-3", "beatId": "beat-3-2",
                           "startLine": 2, "endLine": 2},
            "sourceText": quote, "knownBy": [], "audienceKnows": True, "confidence": 0.9,
        }]
    )
    new_facts, _p, _c = ledger_policy.apply_extraction_policy(
        extraction, existing_ledger=[], accepted_beat=beat, episode_id="ep-1", scene_id="scene-3"
    )
    span = new_facts[0]["sourceSpan"]
    # second occurrence (line 2) is at offset 10, not the first at offset 0
    assert span["charStart"] == len("same line\n")
    assert beat["scriptText"][span["charStart"]:span["charEnd"]] == quote


# ── span target is server-forced to the accepted beat ────────────────────────


def test_source_span_target_forced_to_accepted_beat():
    lying_fact = _fact(confidence=0.9)
    lying_fact["sourceSpan"]["beatId"] = "beat-elsewhere"  # model lies about the beat
    lying_fact["sourceSpan"]["sceneId"] = "scene-9"
    new_facts, _p, _c = _apply(_extraction([lying_fact]))
    span = new_facts[0]["sourceSpan"]
    assert span["beatId"] == "beat-3-2" and span["sceneId"] == "scene-3"


# ── supersede proposals (§5 / §4): original untouched, no overwrite ──────────


def _fact07() -> dict:
    return {
        "id": "fact-07", "fact": "Dan has never been in trouble with the law",
        "factType": "state",
        "sourceSpan": {"episodeId": "ep-1", "sceneId": "scene-3", "beatId": "beat-3-1",
                       "startLine": None, "endLine": None, "charStart": None, "charEnd": None},
        "sourceText": "", "knownBy": ["char-marta", "char-luz"], "audienceKnows": True,
        "provenance": "writer_authored", "confidence": 1.0, "status": "active",
        "supersedes": None, "supersededBy": None,
    }


def test_contradiction_creates_supersede_proposal_original_untouched():
    ledger = [_fact07()]
    extraction = _extraction(
        new_facts=[_fact(confidence=0.95)],
        contradictions=[{"existingFactId": "fact-07",
                         "explanation": "Dan is now arrested.",
                         "proposedReplacement": "Dan has been arrested."}],
    )
    new_facts, proposals, contradictions = _apply(extraction, existing_ledger=ledger)

    assert len(proposals) == 1
    proposal = proposals[0]
    assert proposal["supersedes"] == "fact-07"
    assert proposal["supersededBy"] is None
    assert proposal["status"] == "pending_review"
    assert proposal["provenance"] == "inferred"
    assert proposal["fact"] == "Dan has been arrested."  # proposedReplacement
    assert proposal["factType"] == "state"  # inherited from target
    assert proposal["knownBy"] == ["char-marta", "char-luz"]

    # the original fact object is NOT mutated (no overwrite)
    assert ledger[0]["status"] == "active"
    assert ledger[0]["supersededBy"] is None

    # response contradiction record links to the proposal
    assert contradictions[0]["existingFactId"] == "fact-07"
    assert contradictions[0]["proposalId"] == proposal["id"]


def test_null_proposed_replacement_carries_forward_target_text():
    ledger = [_fact07()]
    extraction = _extraction(
        contradictions=[{"existingFactId": "fact-07", "explanation": "no longer true",
                         "proposedReplacement": None}],
    )
    _nf, proposals, _c = _apply(extraction, existing_ledger=ledger)
    assert proposals[0]["fact"] == "Dan has never been in trouble with the law"


def test_contradiction_against_unknown_fact_is_dropped():
    extraction = _extraction(
        contradictions=[{"existingFactId": "fact-does-not-exist", "explanation": "x",
                         "proposedReplacement": "y"}],
    )
    _nf, proposals, contradictions = _apply(extraction, existing_ledger=[_fact07()])
    assert proposals == [] and contradictions == []


def test_new_fact_ids_do_not_collide_with_existing_ledger():
    ledger = [_fact07()]  # fact-07 present; next mint must be fact-08+
    extraction = _extraction(
        new_facts=[_fact(0.9), _fact(0.9)],
        contradictions=[{"existingFactId": "fact-07", "explanation": "x",
                         "proposedReplacement": "z"}],
    )
    new_facts, proposals, _c = _apply(extraction, existing_ledger=ledger)
    minted = [f["id"] for f in new_facts] + [p["id"] for p in proposals]
    assert minted == ["fact-08", "fact-09", "fact-10"]
    assert "fact-07" not in minted
