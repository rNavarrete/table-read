"""T10.4 knowledge grid on import: a knowledge-event belief survives only on
`suspects`/`misinformed`. Logs carry counts, never the text."""

from __future__ import annotations

import logging

from fountain import pipeline
from schemas import LedgerExtraction


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
        (fact,), _cast = pipeline._assemble_facts([extracted], [], "", {})

    assert [e["belief"] for e in fact["knowledgeEvents"]] == [
        "",
        "the money went to the bank",
        "Sal took it",
        "",
    ]
    assert "import_fact_beliefs blanked=1" in caplog.text
    assert "bank" not in caplog.text and "Sal" not in caplog.text
