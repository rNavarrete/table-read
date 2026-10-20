"""T10.8 exposition audit: facts carry `delivery` and `neededBySceneId`
through storage (old rows and dev DBs read null)."""

from __future__ import annotations

from sqlalchemy import create_engine, inspect, text

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
