"""Breakdown export (T10.10): `GET /projects/{pid}/export.breakdown.csv` and
`fountain.export.to_breakdown_csv` — one row per scene in board order."""

from __future__ import annotations

import copy
import csv
import io

import pytest
from fastapi.testclient import TestClient

from fountain.acts import act_label
from fountain.export import BREAKDOWN_COLUMNS, to_breakdown_csv
from main import app
from storage.models import SnapshotRow
from storage.seed import load_fixture, seed_envelope

client = TestClient(app)

PROJECT_ID = "proj-longpour"
FOUR_ACTS_COLD_OPEN = {"actCount": 4, "coldOpen": True, "tag": False}


def rows(text: str) -> list[dict]:
    return list(csv.DictReader(io.StringIO(text.removeprefix("\ufeff"))))


def project(scenes: list[dict], **episode) -> dict:
    return {
        "title": "T",
        "format": FOUR_ACTS_COLD_OPEN,
        "seriesBible": {
            "characters": [
                {"id": "char-marta", "name": "Marta Vega", "aliases": ["Mar"]},
                {"id": "char-dan", "name": "Dan Vega", "aliases": []},
                {"id": "char-reyes", "name": "Ana Reyes", "aliases": []},
            ]
        },
        "seasons": [{"episodes": [{"scenes": scenes, **episode}]}],
    }


def scene(sid: str, act: int, index: int, **fields) -> dict:
    return {"id": sid, "act": act, "index": index, "beats": [], **fields}


# ── act labels: the same cases as the web's actLabel (planTree.test.ts) ──────


@pytest.mark.parametrize(
    ("act", "fmt", "label"),
    [
        (0, FOUR_ACTS_COLD_OPEN, "COLD OPEN"),
        (1, FOUR_ACTS_COLD_OPEN, "ACT ONE"),
        (4, FOUR_ACTS_COLD_OPEN, "ACT FOUR"),
        (0, {**FOUR_ACTS_COLD_OPEN, "coldOpen": False}, "ACT ONE"),
        (5, {**FOUR_ACTS_COLD_OPEN, "tag": True}, "TAG"),
        (4, {**FOUR_ACTS_COLD_OPEN, "tag": True}, "ACT FOUR"),
        (4, {**FOUR_ACTS_COLD_OPEN, "tag": True, "coldOpen": False}, "TAG"),
        (3, {**FOUR_ACTS_COLD_OPEN, "tag": True, "coldOpen": False}, "ACT FOUR"),
        (5, FOUR_ACTS_COLD_OPEN, "ACT FIVE"),
        (4, {**FOUR_ACTS_COLD_OPEN, "coldOpen": False}, "ACT FIVE"),
        (9, FOUR_ACTS_COLD_OPEN, "ACT 9"),
    ],
)
def test_act_label_matches_the_web(act, fmt, label):
    assert act_label(act, fmt) == label


# ── the endpoint ─────────────────────────────────────────────────────────────


def test_export_is_a_named_csv_attachment_in_board_order(seeded_project, db_session):
    head = seeded_project["project"]["headSnapshotId"]
    snapshot_count = db_session.query(SnapshotRow).count()

    resp = client.get(f"/api/v1/projects/{PROJECT_ID}/export.breakdown.csv")

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/csv")
    assert resp.headers["content-disposition"] == (
        'attachment; filename="The_Long_Pour-breakdown.csv"'
    )
    assert resp.text.startswith("\ufeff")
    header = next(csv.reader(io.StringIO(resp.text.removeprefix("\ufeff"))))
    assert tuple(header) == BREAKDOWN_COLUMNS
    body = rows(resp.text)
    assert [r["Scene"] for r in body] == ["1", "2", "3", "4", "5", "6"]
    assert [r["Act"] for r in body] == [
        "COLD OPEN", "ACT ONE", "ACT ONE", "ACT TWO", "ACT THREE", "ACT FOUR",
    ]
    assert body[2]["Turns"] == "yes"  # scene-3: mixed → negative
    assert body[0]["Facts established"] == "4"
    assert body[0]["Characters"] == "Marta Vega; Dan Vega"
    # Read-only: no snapshot, head unchanged.
    db_session.expire_all()
    assert db_session.query(SnapshotRow).count() == snapshot_count
    assert client.get(f"/api/v1/projects/{PROJECT_ID}").json()["headSnapshotId"] == head


def test_unknown_project_is_404():
    resp = client.get("/api/v1/projects/nope/export.breakdown.csv")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


def test_project_with_no_episode_exports_the_header_only(db_session):
    envelope = copy.deepcopy(load_fixture())
    envelope["project"]["title"] = "Fresh / Show!"
    envelope["project"]["seasons"] = []
    seed_envelope(db_session, envelope)

    resp = client.get(f"/api/v1/projects/{PROJECT_ID}/export.breakdown.csv")

    assert resp.status_code == 200
    assert 'filename="Fresh_Show_-breakdown.csv"' in resp.headers["content-disposition"]
    assert resp.text == "\ufeff" + ",".join(BREAKDOWN_COLUMNS) + "\r\n"


# ── the rows ─────────────────────────────────────────────────────────────────


def test_rows_follow_act_then_index_not_the_array():
    doc = project(
        [
            scene(sid, act, index, whatHappens=sid)
            for sid, act, index in [("a", 2, 0), ("b", 0, 5), ("c", 1, 2), ("d", 1, 1)]
        ]
    )
    body = rows(to_breakdown_csv(doc, []))
    assert [(r["Scene"], r["Act"], r["What happens"]) for r in body] == [
        ("1", "COLD OPEN", "b"),
        ("2", "ACT ONE", "d"),
        ("3", "ACT ONE", "c"),
        ("4", "ACT TWO", "a"),
    ]


def test_tag_and_cold_open_labels():
    doc = project([scene("scene-1", 0, 0), scene("scene-2", 4, 1), scene("scene-3", 5, 2)])
    doc["format"] = {**FOUR_ACTS_COLD_OPEN, "tag": True}
    assert [r["Act"] for r in rows(to_breakdown_csv(doc, []))] == [
        "COLD OPEN", "ACT FOUR", "TAG",
    ]


def test_commas_newlines_and_quotes_are_quoted():
    tricky = 'She says "no", then\nleaves, slowly.'
    text = to_breakdown_csv(project([scene("scene-1", 1, 0, whatHappens=tricky)]), [])
    assert '"She says ""no"", then\nleaves, slowly."' in text
    assert rows(text)[0]["What happens"] == tricky


def test_missing_values_are_empty_cells():
    row = rows(to_breakdown_csv(project([scene("scene-1", 1, 0, chargeIn="positive")]), []))[0]
    assert row["Beats"] == "0"
    assert row["Facts established"] == "0"
    for column in BREAKDOWN_COLUMNS:
        if column not in ("Scene", "Act", "Beats", "Facts established", "Charge in"):
            assert row[column] == "", column


def test_turns_is_yes_no_or_empty():
    def turns(**charges):
        return rows(to_breakdown_csv(project([scene("s", 1, 0, **charges)]), []))[0]["Turns"]

    assert turns(chargeIn="positive", chargeOut="negative") == "yes"
    assert turns(chargeIn="mixed", chargeOut="mixed") == "no"
    assert turns(chargeIn="positive", chargeOut=None) == ""


def test_kernel_and_choice_counts_with_or_without_t10_9_fields():
    read = [
        {"id": "b1", "kernel": True, "pressureChoice": False},
        {"id": "b2", "kernel": True, "pressureChoice": True},
        {"id": "b3", "kernel": False, "pressureChoice": None},
    ]
    row = rows(to_breakdown_csv(project([scene("s", 1, 0, beats=read)]), []))[0]
    assert (row["Beats"], row["Kernel beats"], row["Choices"]) == ("3", "2", "1")
    # Before T10.9 (absent) or not read (null): empty, not zero.
    unread = [{"id": "b1"}, {"id": "b2", "kernel": None, "pressureChoice": None}]
    row = rows(to_breakdown_csv(project([scene("s", 1, 0, beats=unread)]), []))[0]
    assert (row["Beats"], row["Kernel beats"], row["Choices"]) == ("2", "", "")


def test_ledger_columns():
    s1 = scene(
        "scene-1",
        1,
        0,
        storyline="B",
        motivations=[
            {"characterId": "char-dan", "objective": "Hide the money"},
            {"characterId": "char-gone", "objective": "Leave"},
            {"characterId": "char-reyes", "objective": ""},
        ],
        beats=[{"id": "b1", "scriptText": "MAR\nWhere is it?\n\nBARTENDER\nLast call."}],
    )
    s2 = scene("scene-2", 1, 1)
    doc = project(
        [s1, s2],
        threads=[
            {"label": "The money", "setupSceneId": "scene-1", "payoffSceneId": "scene-2",
             "movements": [{"sceneId": "scene-1", "phase": "setup"}]},
            {"label": "The bar", "setupSceneId": "scene-0", "payoffSceneId": None,
             "movements": [{"sceneId": "scene-1", "phase": "escalation"},
                           {"sceneId": "scene-1", "phase": "reversal"},
                           {"sceneId": "scene-2", "phase": "payoff"}]},
        ],
        secrets=[
            {"summary": "Dan took it", "establishedSceneId": "scene-1",
             "revealedSceneId": "scene-2", "concealmentSceneIds": []},
            {"summary": "Reyes knows", "establishedSceneId": "scene-0",
             "revealedSceneId": None, "concealmentSceneIds": ["scene-1"]},
        ],
        storyOverview={
            "outline": [
                {"sceneId": "scene-1", "storyOrder": 1, "storyTime": "Day 2",
                 "anachrony": "none"},
                {"sceneId": "scene-2", "storyOrder": 0, "storyTime": "Day 1",
                 "anachrony": "flashback"},
            ]
        },
    )
    ledger = [
        {"sourceSpan": {"sceneId": "scene-1"}, "status": "active"},
        {"sourceSpan": {"sceneId": "scene-1"}, "status": "pending_review"},
        {"sourceSpan": {"sceneId": "scene-1"}, "status": "rejected"},
        {"sourceSpan": {"sceneId": "scene-2"}, "status": "active"},
    ]
    first, second = rows(to_breakdown_csv(doc, ledger))
    assert first["Storyline"] == "B"
    assert first["Wants"] == "Dan Vega: Hide the money; char-gone: Leave"
    assert first["Threads set up"] == "The money"
    assert first["Threads paid off"] == ""
    assert first["Threads moving"] == "The bar (escalation, reversal)"
    assert first["Secrets"] == "Dan took it (set); Reyes knows (kept)"
    assert first["Facts established"] == "2"
    # Bible order; an alias cue counts; an unmatched cue (BARTENDER) does not.
    assert first["Characters"] == "Marta Vega; Dan Vega; Ana Reyes"
    assert (first["Story order"], first["Story time"], first["Anachrony"]) == ("2", "Day 2", "")
    assert second["Threads paid off"] == "The money"
    assert second["Threads moving"] == "The bar (payoff)"
    assert second["Secrets"] == "Dan took it (out)"
    assert (second["Story order"], second["Anachrony"]) == ("1", "flashback")

