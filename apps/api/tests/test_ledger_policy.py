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


def test_null_proposed_replacement_stores_empty_fact_text():
    """Retirement proposals: stored-null detection — null proposedReplacement
    mints with empty ``fact`` (not carry-forward of the target text)."""
    ledger = [_fact07()]
    extraction = _extraction(
        contradictions=[{"existingFactId": "fact-07", "explanation": "no longer true",
                         "proposedReplacement": None}],
    )
    _nf, proposals, _c = _apply(extraction, existing_ledger=ledger)
    assert proposals[0]["fact"] == ""
    assert proposals[0]["supersedes"] == "fact-07"
    assert proposals[0]["status"] == "pending_review"


def test_contradiction_against_non_active_target_is_dropped():
    """Creation-time guard: only active facts can be supersede targets."""
    pending = {**_fact07(), "id": "fact-06", "status": "pending_review"}
    extraction = _extraction(
        contradictions=[{"existingFactId": "fact-06", "explanation": "x",
                         "proposedReplacement": "y"}],
    )
    _nf, proposals, contradictions = _apply(extraction, existing_ledger=[pending])
    assert proposals == [] and contradictions == []


def test_contradiction_against_unknown_fact_is_dropped():
    extraction = _extraction(
        contradictions=[{"existingFactId": "fact-does-not-exist", "explanation": "x",
                         "proposedReplacement": "y"}],
    )
    _nf, proposals, contradictions = _apply(extraction, existing_ledger=[_fact07()])
    assert proposals == [] and contradictions == []


def test_new_fact_ids_do_not_collide_with_existing_ledger():
    ledger = [_fact07()]  # fact-07 present; next mint must not reuse it
    extraction = _extraction(
        new_facts=[_fact(0.9), _fact(0.9)],
        contradictions=[{"existingFactId": "fact-07", "explanation": "x",
                         "proposedReplacement": "z"}],
    )
    new_facts, proposals, _c = _apply(extraction, existing_ledger=ledger)
    minted = [f["id"] for f in new_facts] + [p["id"] for p in proposals]
    assert len(minted) == 3
    assert len(set(minted)) == 3
    assert "fact-07" not in minted
    assert all(i.startswith("fact-") for i in minted)


def test_curly_apostrophe_in_source_still_verifies():
    """A quote is not ungrounded because of typography.

    Imported PDFs (OCR especially) are full of curly quotes while a model
    quoting them back normalizes to ASCII. On a real 60-page import this
    single mismatch demoted 61 of 120 facts that were all genuinely on the
    page — invisibly, since a demoted fact just lands in the review queue.
    """
    script = "SAM\nIt’s Potus.\n"
    start, end, verified = ledger_policy.verify_source_text(script, "It's Potus.", 1, 2)
    assert verified is True
    # Offsets must index the ORIGINAL text, curly character and all.
    assert script[start:end] == "It’s Potus."


def test_curly_double_quotes_and_dashes_verify():
    script = 'TOBY\n“The number” — he said.\n'
    _s, _e, verified = ledger_policy.verify_source_text(script, '"The number" - he said.', 1, 2)
    assert verified is True


def test_typographic_fold_is_length_preserving():
    """The offsets returned by verify_source_text depend on this.

    Folding is applied to the haystack before `find`, so the index it returns
    is only valid in the original string if every substitution is 1 character
    to 1 character. A map entry like "…" -> "..." would silently shift every
    offset after it and mis-highlight the Ledger's jump-to-source.
    """
    for source, replacement in ledger_policy._TYPOGRAPHIC_FOLD.items():
        assert replacement is not None
        assert len(chr(source)) == len(replacement) == 1
    sample = "a’b“c—d"
    assert len(ledger_policy._fold_typography(sample)) == len(sample)


def test_genuinely_absent_quote_is_still_unverified():
    """The fold must not turn verification into a rubber stamp."""
    script = "SAM\nIt's Potus.\n"
    start, end, verified = ledger_policy.verify_source_text(script, "He resigned on Tuesday.", 1, 2)
    assert (start, end, verified) == (None, None, False)


# ── locate_quote: import offsets only, never activation (T9.9) ───────────────


def test_locate_quote_finds_offsets():
    text = "INT. BAR - NIGHT\nDan pours a drink."
    start, end = ledger_policy.locate_quote(text, "Dan pours", 2, 2)
    assert text[start:end] == "Dan pours"


def test_locate_quote_disambiguates_by_line_window():
    text = "the money\nnothing here\nthe money"  # duplicate quote
    start, end = ledger_policy.locate_quote(text, "the money", 3, 3)
    assert start == text.rindex("the money")
    assert text[start:end] == "the money"


def test_locate_quote_absent_returns_none():
    assert ledger_policy.locate_quote("Dan pours.", "not present", 1, 1) == (None, None)


def test_locate_quote_empty_returns_none():
    assert ledger_policy.locate_quote("Dan pours.", "", 1, 1) == (None, None)


def test_locate_quote_falls_back_to_whole_beat():
    text = "INT. BAR - NIGHT\nDan pours a drink."
    start, end = ledger_policy.locate_quote(text, "Dan pours", 1, 1)  # stale window
    assert text[start:end] == "Dan pours"


def test_locate_quote_matches_through_typography_and_whitespace():
    text = "SAM\nIt’s   the  money,\n    Billy — honest."
    start, end = ledger_policy.locate_quote(text, "It's the money, Billy - honest.", 2, 3)
    assert text[start:end] == "It’s   the  money,\n    Billy — honest."


def test_locate_quote_unescapes_html_on_both_sides():
    text = "JOSH\nSam &amp; Toby say 2 < 3."
    start, end = ledger_policy.locate_quote(text, "Sam & Toby say 2 &lt; 3.", 2, 2)
    assert text[start:end] == "Sam &amp; Toby say 2 < 3."
    # A bare ampersand is not a reference: offsets stay per character.
    assert ledger_policy.locate_quote("Sam runs R&D now.", "D now.", 1, 1) == (11, 17)


def test_locate_quote_skips_page_furniture():
    text = (
        "SAM\nI was going to say that we\n(MORE)\n\n12.\nCONTINUED: (2)\n"
        "SAM (CONT’D)\nshould go home.\n\nBILLY\nNo."
    )
    start, end = ledger_policy.locate_quote(
        text, "I was going to say that we should go home.", 2, 8
    )
    assert start == text.index("I was")
    assert end == text.index("home.") + len("home.")


def test_locate_quote_keeps_a_cue_line_the_quote_includes():
    text = "JOSH\nYes.\n\nSAM (CONT'D)\nYes."
    # Verbatim: the same offsets verify_source_text gives, not Josh's line.
    assert ledger_policy.locate_quote(text, "SAM (CONT'D)\nYes.", 1, 5) == (11, 28)
    # Not verbatim (indent, curly apostrophe): still Sam's line.
    text = "JOSH\nYes.\n\nSAM (CONT’D)\n  Yes."
    assert ledger_policy.locate_quote(text, "SAM (CONT'D)\nYes.", 1, 5) == (11, 30)


def test_locate_quote_prefers_the_verbatim_occurrence():
    text = "the  money\nthe money"
    assert ledger_policy.locate_quote(text, "the money", 1, 2) == (11, 20)
    text = "the  money\nX\nthe money"  # stale window: whole beat, verbatim first
    assert ledger_policy.locate_quote(text, "the money", 2, 2) == (13, 22)


def test_locate_quote_finds_a_number_only_quote():
    text = "TOBY\nWhat year?\n\nSAM\n1985."
    assert ledger_policy.locate_quote(text, "1985.", 1, 1) == (21, 26)
    # A number line closing a non-verbatim quote stays inside the span.
    text = "SAM\nIt   was\n1985."
    assert ledger_policy.locate_quote(text, "It was\n1985.", 2, 3) == (4, 18)


def test_out_of_window_quote_is_still_demoted_though_locate_quote_finds_it():
    """locate_quote only sets import offsets; activation stays window-strict."""
    quote = "Reyes snaps the cuffs on Dan."  # on line 3, reported as line 1
    assert ledger_policy.locate_quote(BEAT["scriptText"], quote, 1, 1) != (None, None)
    new_facts, _p, _c = _apply(
        _extraction([_fact(confidence=0.99, source_text=quote, start=1, end=1)])
    )
    assert new_facts[0]["status"] == "pending_review"
    assert new_facts[0]["sourceSpan"]["charStart"] is None
