"""T10.4 knowledge grid on import: a knowledge-event belief survives only on
`suspects`/`misinformed`, and each open secret links `Secret.factId` to the
one fact on its establishing beat (owner decision 2026-10-19: keep import
speed, link by beat — no model citation). Logs carry counts, never the text."""

from __future__ import annotations

import logging

import pytest

from fountain import pipeline
from fountain.parse import split_into_scenes
from llm.mock import MockLlmClient
from schemas import LedgerExtraction, NarrativePromises, SegmentedScene
from storage.project_scaffold import initial_project_doc

FORMAT = {
    "genre": "drama",
    "runtimeMinutes": 30,
    "actCount": 3,
    "coldOpen": False,
    "tag": False,
    "serialization": 0.5,
}


def _extracted(events: list[dict] | None = None, **overrides) -> dict:
    return {
        "fact": "Dan hid the money.",
        "factType": "event",
        "sourceSpan": {
            "episodeId": "ep-1",
            "sceneId": "scene-1",
            "beatId": "beat-1-1",
            "startLine": 1,
            "endLine": 1,
        },
        "sourceText": "",
        "knownBy": [],
        "knowledgeEvents": events or [],
        "audienceKnows": True,
        "confidence": 0.95,
        **overrides,
    }


def _extraction(*facts: dict) -> LedgerExtraction:
    return LedgerExtraction.model_validate({"newFacts": list(facts), "contradictions": []})


def test_a_belief_survives_only_on_suspects_and_misinformed(caplog):
    def event(kind: str, belief: str) -> dict:
        return {"sceneId": "scene-1", "characterNames": [], "kind": kind, "belief": belief}

    extracted = _extraction(
        _extracted(
            events=[
                event("learns", "it was the bank"),
                event("suspects", "the money went to the bank"),
                event("misinformed", "Sal took it"),
                event("forgets", ""),
            ]
        )
    )

    with caplog.at_level(logging.INFO, logger="fountain.pipeline"):
        (fact,), _cast = pipeline._assemble_facts([extracted], [], "", {}, set())

    assert [e["belief"] for e in fact["knowledgeEvents"]] == [
        "",
        "the money went to the bank",
        "Sal took it",
        "",
    ]
    assert "import_fact_beliefs blanked=1" in caplog.text
    assert "bank" not in caplog.text and "Sal" not in caplog.text


# ── Secret.factId by beat ────────────────────────────────────────────────────


def _secret(id_: str = "secret-a", **overrides) -> dict:
    return {
        "id": id_,
        "summary": "Dan hid the money in the ice machine.",
        "factId": None,
        "holderCharacterIds": ["char-dan"],
        "concealedFromCharacterIds": ["char-marta"],
        "audienceKnows": True,
        "establishedSceneId": "scene-2",
        "establishedBeatId": "beat-2-2",
        "locked": False,
        **overrides,
    }


def _fact(id_: str, beat_id: str = "beat-2-2", **overrides) -> dict:
    scene_id = "scene-" + beat_id.split("-")[1]
    return {
        "id": id_,
        "fact": "The money is in the ice machine.",
        "sourceSpan": {"episodeId": "ep-1", "sceneId": scene_id, "beatId": beat_id},
        "knownBy": ["char-dan"],
        "audienceKnows": True,
        "status": "active",
        **overrides,
    }


def _link(secrets: list[dict], facts: list[dict], caplog) -> str:
    with caplog.at_level(logging.INFO, logger="fountain.pipeline"):
        pipeline._link_secret_facts(secrets, facts)
    (line,) = [r.getMessage() for r in caplog.records if "import_secret_links" in r.getMessage()]
    assert "money" not in line and "ice machine" not in line
    return line


def test_the_one_fact_on_the_establishing_beat_links(caplog):
    secret = _secret()
    facts = [
        _fact("fact-other-beat", "beat-2-1"),
        _fact("fact-hit"),
        _fact("fact-rejected", status="rejected"),
    ]

    line = _link([secret], facts, caplog)

    assert secret["factId"] == "fact-hit"
    assert "linked=1 no_candidate=0 ambiguous=0 contested=0" in line


def test_without_an_establishing_beat_the_scene_decides(caplog):
    secret = _secret(establishedBeatId=None)
    facts = [_fact("fact-scene-1", "beat-1-1"), _fact("fact-scene-2", "beat-2-3")]

    _link([secret], facts, caplog)

    assert secret["factId"] == "fact-scene-2"


def test_a_fact_must_be_known_to_every_holder_and_to_no_one_kept_in_the_dark(caplog):
    secret = _secret(holderCharacterIds=["char-dan", "char-sal"])
    facts = [
        _fact("fact-dan-only"),
        _fact("fact-leaked", knownBy=["char-dan", "char-sal", "char-marta"]),
        _fact("fact-both", knownBy=["char-sal", "char-dan", "char-reyes"]),
    ]

    _link([secret], facts, caplog)

    assert secret["factId"] == "fact-both"


def test_the_audience_tie_break_prefers_a_matching_fact_and_otherwise_stays_ambiguous(caplog):
    hidden = _secret(audienceKnows=False)
    _link(
        [hidden],
        [_fact("fact-shown"), _fact("fact-hidden", audienceKnows=False)],
        caplog,
    )
    assert hidden["factId"] == "fact-hidden"

    caplog.clear()
    secret = _secret()
    line = _link([secret], [_fact("fact-1"), _fact("fact-2")], caplog)
    assert secret["factId"] is None
    assert "linked=0 no_candidate=0 ambiguous=1 contested=0" in line


def test_no_candidate_leaves_it_null(caplog):
    secret = _secret()
    line = _link([secret], [_fact("fact-leaked", knownBy=["char-dan", "char-marta"])], caplog)
    assert secret["factId"] is None
    assert "no_candidate=1" in line


def test_a_fact_two_secrets_would_claim_links_neither(caplog):
    first, second = _secret("secret-a"), _secret("secret-b", summary="Another reading.")
    line = _link([first, second], [_fact("fact-hit")], caplog)
    assert first["factId"] is None and second["factId"] is None
    assert "linked=0 no_candidate=0 ambiguous=0 contested=2" in line


def test_a_locked_or_already_linked_secret_is_untouched(caplog):
    locked = _secret("secret-a", locked=True)
    linked = _secret("secret-b", factId="fact-kept")
    line = _link([locked, linked], [_fact("fact-hit")], caplog)
    assert locked["factId"] is None
    assert linked["factId"] == "fact-kept"
    assert "linked=0 no_candidate=0 ambiguous=0 contested=0" in line


SCRIPT = """INT. BAR - NIGHT

DAN
I'm closing up.

MARTA
Where did the money go?
"""


@pytest.mark.parametrize("overlap", [True, False], ids=["overlap", "serial"])
def test_a_mock_import_links_its_secret(monkeypatch, overlap):
    """End to end on `MockLlmClient`: threads find Dan hiding the money from
    Marta in scene 1; extraction reports the fact twice over — once known to
    Dan, once to Marta — and only Dan's version is the secret's truth."""
    monkeypatch.setattr(pipeline, "IMPORT_OVERLAP", overlap)
    llm = MockLlmClient()
    llm.set_responses(
        "segment_scene",
        [
            SegmentedScene.model_validate(
                {
                    "segments": [
                        {
                            "kind": "beat",
                            "startLine": 1,
                            "whatHappens": "w",
                            "audienceLearns": "l",
                            "audienceFeels": "f",
                        }
                    ]
                }
            )
            for _scene in split_into_scenes(SCRIPT)
        ],
    )
    promises = llm._responses["infer_narrative_promises"].model_dump(by_alias=True)
    promises["secrets"] = [
        {
            **promises["secrets"][0],
            "establishedSceneId": "scene-1",
            "establishedBeatId": "beat-1-1",
            "concealmentSceneIds": [],
        }
    ]
    llm.set_response("infer_narrative_promises", NarrativePromises.model_validate(promises))
    llm.set_response(
        "extract_ledger_facts",
        _extraction(
            _extracted(knownBy=["Marta"], fact="Marta thinks the bar is broke."),
            _extracted(knownBy=["Dan"]),
        ),
    )

    gen = pipeline.analyze_import(
        initial_project_doc("Bar", FORMAT, ""), [], SCRIPT, llm, nonce="0f0f0f0f"
    )
    while True:
        try:
            next(gen)
        except StopIteration as stop:
            analysis = stop.value
            break

    (secret,) = analysis.new_doc["seasons"][0]["episodes"][0]["secrets"]
    dans = [f for f in analysis.new_facts if f["fact"] == "Dan hid the money."]
    assert secret["factId"] == dans[0]["id"]
