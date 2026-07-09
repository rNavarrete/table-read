"""PATCH lock guard — the rule-2 write-side enforcement for direct edits
(data contract §4 "Patches into locked ranges → 409 LOCKED_OBJECT"; test plan
line 19). These lock-violation tests come first (CLAUDE.md rule 2 ordering):
the guarantee is that no PATCH writes into locked content, and that a rejected
PATCH changes *nothing*.

The fixture's beat-1-2 is `locked` + `scriptLocked`; scene-1 (its parent) is
unlocked, so it doubles as the "insert around a locked beat" case. No LLM is
needed here — every path is either rejected before the structural scan runs, or
is a non-structural edit.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from main import app
from storage.models import SnapshotRow

client = TestClient(app)

PROJECT_ID = "proj-longpour"

# JSON Pointers into the seeded fixture's single season/episode.
SCENE_1 = "/seasons/0/episodes/0/scenes/0"
SCENE_3 = "/seasons/0/episodes/0/scenes/2"
BEAT_1_2 = f"{SCENE_1}/beats/1"  # locked + scriptLocked in the fixture


def _snap_count(db_session) -> int:
    return db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()


def _patch(patch: list):
    return client.patch(f"/api/v1/projects/{PROJECT_ID}", json=patch)


def _new_beat(beat_id: str, index: int) -> dict:
    return {
        "id": beat_id,
        "index": index,
        "locked": False,
        "whatHappens": "A new beat lands.",
        "audienceLearns": "Something.",
        "audienceFeels": "Something.",
        "scriptText": "MARTA\nNew line.",
        "scriptLocked": False,
    }


# ── rejected: writes into locked content leave zero mutations ─────────────────


def test_patch_scriptlocked_beat_scripttext_is_rejected(seeded_project, db_session):
    before = client.get(f"/api/v1/projects/{PROJECT_ID}").json()
    snaps_before = _snap_count(db_session)

    resp = _patch([{"op": "replace", "path": f"{BEAT_1_2}/scriptText", "value": "rewritten"}])

    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "LOCKED_OBJECT"
    # zero mutations: doc byte-identical, no new snapshot
    assert client.get(f"/api/v1/projects/{PROJECT_ID}").json() == before
    assert _snap_count(db_session) == snaps_before


def test_patch_locked_beat_plan_field_is_rejected(seeded_project, db_session):
    snaps_before = _snap_count(db_session)
    resp = _patch([{"op": "replace", "path": f"{BEAT_1_2}/whatHappens", "value": "x"}])
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "LOCKED_OBJECT"
    assert _snap_count(db_session) == snaps_before


def test_patch_into_locked_scene_content_is_rejected_zero_mutations(seeded_project, db_session):
    # Lock scene-3 first (a lock-flip PATCH is the writer's own pin — allowed).
    lock_resp = _patch([{"op": "replace", "path": f"{SCENE_3}/locked", "value": True}])
    assert lock_resp.status_code == 200
    locked_state = client.get(f"/api/v1/projects/{PROJECT_ID}").json()
    snaps_after_lock = _snap_count(db_session)

    # Now any content edit to that scene is rejected, changing nothing further.
    resp = _patch([{"op": "replace", "path": f"{SCENE_3}/location", "value": "INT. MARINA"}])
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "LOCKED_OBJECT"
    assert client.get(f"/api/v1/projects/{PROJECT_ID}").json() == locked_state
    assert _snap_count(db_session) == snaps_after_lock


def test_patch_removing_a_locked_beat_is_rejected(seeded_project):
    resp = _patch([{"op": "remove", "path": BEAT_1_2}])
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "LOCKED_OBJECT"


# ── allowed: the writer's own pins and structural position ────────────────────


def test_unlock_flip_on_a_locked_beat_succeeds(seeded_project, db_session):
    resp = _patch([{"op": "replace", "path": f"{BEAT_1_2}/scriptLocked", "value": False}])
    assert resp.status_code == 200
    beat = client.get(f"/api/v1/projects/{PROJECT_ID}").json()["seasons"][0]["episodes"][0][
        "scenes"
    ][0]["beats"][1]
    assert beat["scriptLocked"] is False


def test_scene_lock_flip_succeeds(seeded_project):
    resp = _patch([{"op": "replace", "path": f"{SCENE_1}/locked", "value": True}])
    assert resp.status_code == 200


def test_reindexing_a_locked_beat_is_allowed(seeded_project):
    # `index` is position, not content (T2.2 ruling) — a locked beat may be
    # reindexed even though its plan/script cannot be touched.
    resp = _patch([{"op": "replace", "path": f"{BEAT_1_2}/index", "value": 5}])
    assert resp.status_code == 200
    beat = client.get(f"/api/v1/projects/{PROJECT_ID}").json()["seasons"][0]["episodes"][0][
        "scenes"
    ][0]["beats"][1]
    assert beat["index"] == 5


def test_inserting_a_beat_after_a_locked_beat_succeeds(seeded_project):
    # scene-1 is unlocked; inserting around its locked beat-1-2 is allowed
    # (test plan line 19 "insertion before/after succeeds"). The locked beat's
    # content must be untouched.
    locked_before = client.get(f"/api/v1/projects/{PROJECT_ID}").json()["seasons"][0][
        "episodes"
    ][0]["scenes"][0]["beats"][1]

    resp = _patch(
        [{"op": "add", "path": f"{SCENE_1}/beats/-", "value": _new_beat("beat-1-9", 2)}]
    )
    assert resp.status_code == 200
    beats = client.get(f"/api/v1/projects/{PROJECT_ID}").json()["seasons"][0]["episodes"][0][
        "scenes"
    ][0]["beats"]
    assert [b["id"] for b in beats] == ["beat-1-1", "beat-1-2", "beat-1-9"]
    assert beats[1] == locked_before  # locked beat preserved byte-identical
