"""T10.8 exposition audit: import keeps each fact's `delivery` and a
`neededBySceneId` that names a scene of the episode (anything else is
nulled, counted in the log without the text), and storage carries both (old
rows and dev DBs read null)."""

from __future__ import annotations

import logging

from sqlalchemy import create_engine, inspect, text

from fountain import pipeline
from llm.mock import MockLlmClient
from schemas import LedgerExtraction
from storage import db
from storage.models import LedgerFactRow

_WIRE = {
    "id": "fact-1",
    "fact": "Dan hid the money.",
    "factType": "event",
    "sourceSpan": {"episodeId": "ep-1", "sceneId": "scene-2", "beatId": "beat-2-1"},
    "sourceText": "",
    "knownBy": [],
    "audienceKnows": True,
    "provenance": "inferred",
    "confidence": 0.9,
    "status": "active",
    "supersedes": None,
    "supersededBy": None,
}


def test_a_fact_row_keeps_delivery_and_need_and_reads_null_without_them():
    read = {"delivery": "stated", "neededBySceneId": "scene-4"}
    kept = LedgerFactRow.from_wire_dict("p", {**_WIRE, **read}).to_wire_dict()
    assert {key: kept[key] for key in read} == read
    old = LedgerFactRow.from_wire_dict("p", _WIRE).to_wire_dict()
    assert (old["delivery"], old["neededBySceneId"]) == (None, None)


def test_storage_upgrade_adds_the_columns_to_an_old_dev_db(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with engine.begin() as connection:
        connection.execute(
            text("CREATE TABLE ledger_facts (id VARCHAR PRIMARY KEY, knowledge_events JSON)")
        )
    monkeypatch.setattr(db, "engine", engine)

    db.ensure_storage_schema()
    db.ensure_storage_schema()  # idempotent

    columns = {column["name"] for column in inspect(engine).get_columns("ledger_facts")}
    assert {"delivery", "needed_by_scene_id"} <= columns


def _extracted(**read) -> dict:
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
        "audienceKnows": True,
        "confidence": 0.95,
        **read,
    }


def test_import_keeps_delivery_and_nulls_a_need_outside_the_episode(caplog):
    extraction = LedgerExtraction.model_validate(
        {
            "newFacts": [
                _extracted(delivery="stated", neededBySceneId="scene-2"),
                _extracted(delivery="implied", neededBySceneId="scene-99"),
                _extracted(),
            ],
            "contradictions": [],
        }
    )

    with caplog.at_level(logging.INFO, logger="fountain.pipeline"):
        facts, _cast = pipeline._assemble_facts(
            [extraction], [], "", {}, {"scene-1", "scene-2"}
        )

    assert [(f["delivery"], f["neededBySceneId"]) for f in facts] == [
        ("stated", "scene-2"),
        ("implied", None),
        (None, None),
    ]
    assert "import_fact_needs nulled=1" in caplog.text
    assert "scene-99" not in caplog.text and "money" not in caplog.text


def test_the_mock_extraction_returns_a_delivery_and_a_need():
    (fact,) = MockLlmClient().extract_ledger_facts(
        system="", user_message="", prompt_version="test"
    ).new_facts
    assert (fact.delivery, fact.needed_by_scene_id) == ("shown", "scene-3")
