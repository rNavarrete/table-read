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
EPISODE = "/seasons/0/episodes/0"
SCENE_1 = "/seasons/0/episodes/0/scenes/0"
SCENE_2 = "/seasons/0/episodes/0/scenes/1"
SCENE_3 = "/seasons/0/episodes/0/scenes/2"
SCENE_4 = "/seasons/0/episodes/0/scenes/3"
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


def test_patch_locked_scene_act_is_rejected_without_snapshot(
    seeded_project, db_session
):
    lock_resp = _patch(
        [{"op": "replace", "path": f"{SCENE_3}/locked", "value": True}]
    )
    assert lock_resp.status_code == 200
    snaps_after_lock = _snap_count(db_session)

    resp = _patch([{"op": "replace", "path": f"{SCENE_3}/act", "value": 2}])

    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "LOCKED_OBJECT"
    assert _snap_count(db_session) == snaps_after_lock


def test_patch_shifting_a_locked_scene_index_is_rejected_without_snapshot(
    seeded_project, db_session
):
    # Insert scene-2 after scene-3: locked scene-3 would shift from index 2 to 1.
    lock = _patch([{"op": "replace", "path": f"{SCENE_3}/locked", "value": True}])
    assert lock.status_code == 200
    before = client.get(f"/api/v1/projects/{PROJECT_ID}").json()
    snaps = _snap_count(db_session)

    resp = _patch(
        [
            {"op": "replace", "path": f"{SCENE_2}/index", "value": 2},
            {"op": "replace", "path": f"{SCENE_3}/index", "value": 1},
        ]
    )

    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "LOCKED_OBJECT"
    assert client.get(f"/api/v1/projects/{PROJECT_ID}").json() == before
    assert _snap_count(db_session) == snaps


def test_patch_shifting_a_scene_index_in_a_locked_episode_is_rejected(
    seeded_project, db_session
):
    lock = _patch([{"op": "replace", "path": f"{EPISODE}/locked", "value": True}])
    assert lock.status_code == 200
    snaps = _snap_count(db_session)

    resp = _patch(
        [
            {"op": "replace", "path": f"{SCENE_1}/index", "value": 1},
            {"op": "replace", "path": f"{SCENE_2}/index", "value": 0},
        ]
    )

    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "LOCKED_OBJECT"
    assert _snap_count(db_session) == snaps


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
    # `index` is position, not content — a locked beat in an *unlocked* scene
    # may be reindexed (sibling reindex after insert; ruling 2). Reordering
    # beats *inside* a locked scene is blocked separately.
    resp = _patch([{"op": "replace", "path": f"{BEAT_1_2}/index", "value": 5}])
    assert resp.status_code == 200
    beat = client.get(f"/api/v1/projects/{PROJECT_ID}").json()["seasons"][0]["episodes"][0][
        "scenes"
    ][0]["beats"][1]
    assert beat["index"] == 5


def test_reordering_beats_inside_locked_scene_returns_409(seeded_project, db_session):
    """Adversarial: permute beats of locked scene-1 → 409 LOCKED_OBJECT."""
    import copy

    from storage.models import ProjectRow

    project = db_session.get(ProjectRow, PROJECT_ID)
    doc = copy.deepcopy(project.doc)
    doc["seasons"][0]["episodes"][0]["scenes"][0]["locked"] = True
    project.doc = doc
    db_session.commit()

    before_snaps = _snap_count(db_session)
    # Replace the beats array with a reversed order (same ids, different order).
    beats_path = f"{SCENE_1}/beats"
    current = client.get(f"/api/v1/projects/{PROJECT_ID}").json()["seasons"][0][
        "episodes"
    ][0]["scenes"][0]["beats"]
    reversed_beats = []
    for i, beat in enumerate(reversed(current)):
        b = {**beat, "index": i}
        reversed_beats.append(b)

    resp = _patch([{"op": "replace", "path": beats_path, "value": reversed_beats}])
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "LOCKED_OBJECT"
    assert _snap_count(db_session) == before_snaps

    after = client.get(f"/api/v1/projects/{PROJECT_ID}").json()["seasons"][0][
        "episodes"
    ][0]["scenes"][0]["beats"]
    assert [b["id"] for b in after] == [b["id"] for b in current]


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


def _scenes() -> list[dict]:
    return client.get(f"/api/v1/projects/{PROJECT_ID}").json()["seasons"][0]["episodes"][0][
        "scenes"
    ]


def test_one_patch_of_index_replaces_and_an_act_is_one_snapshot(seeded_project, db_session):
    # Insert scene-4 before scene-2 (T3.8): one gesture = one PATCH = one snapshot.
    array_order = [s["id"] for s in _scenes()]
    snaps = _snap_count(db_session)

    resp = _patch(
        [
            {"op": "replace", "path": f"{SCENE_4}/index", "value": 1},
            {"op": "replace", "path": f"{SCENE_4}/act", "value": 1},
            {"op": "replace", "path": f"{SCENE_2}/index", "value": 2},
            {"op": "replace", "path": f"{SCENE_3}/index", "value": 3},
        ]
    )

    assert resp.status_code == 200
    assert _snap_count(db_session) == snaps + 1
    scenes = _scenes()
    board = [s["id"] for s in sorted(scenes, key=lambda s: (s["act"], s["index"]))]
    assert board == ["scene-1", "scene-4", "scene-2", "scene-3", "scene-5", "scene-6"]
    assert [s["id"] for s in scenes] == array_order


def test_a_multi_op_patch_with_a_bad_op_changes_nothing(seeded_project, db_session):
    before = client.get(f"/api/v1/projects/{PROJECT_ID}").json()
    snaps = _snap_count(db_session)

    resp = _patch(
        [
            {"op": "replace", "path": f"{SCENE_2}/index", "value": 5},
            {"op": "replace", "path": "/seasons/0/episodes/0/scenes/99/index", "value": 1},
        ]
    )

    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "VALIDATION"
    assert client.get(f"/api/v1/projects/{PROJECT_ID}").json() == before
    assert _snap_count(db_session) == snaps
