"""Read-side lock filter (CLAUDE.md hard rule 2, test plan line 16).

Covers the episode→scene→beat cascade and the locked-beat constraint surface
the candidate bundle depends on.
"""

from __future__ import annotations

import copy

import pytest

from drama_manager import locks
from storage.seed import load_fixture


def _doc() -> dict:
    return copy.deepcopy(load_fixture()["project"])


def test_fixture_beat_1_2_is_locked_and_beat_1_1_is_not():
    doc = _doc()
    assert locks.is_locked(doc, "beat-1-2") is True  # locked + scriptLocked in fixture
    assert locks.is_locked(doc, "beat-1-1") is False


def test_scene_lock_cascades_to_child_beats():
    doc = _doc()
    scene1 = doc["seasons"][0]["episodes"][0]["scenes"][0]
    scene1["locked"] = True
    # both beats now locked by cascade, including the previously-unlocked beat-1-1
    assert locks.is_locked(doc, "beat-1-1") is True
    assert locks.is_locked(doc, "beat-1-2") is True
    assert locks.is_locked(doc, "scene-1") is True


def test_episode_lock_cascades_to_scenes_and_beats():
    doc = _doc()
    doc["seasons"][0]["episodes"][0]["locked"] = True
    assert locks.is_locked(doc, "scene-2") is True
    assert locks.is_locked(doc, "beat-2-1") is True
    assert locks.is_locked(doc, "ep-1") is True


def test_unknown_id_is_not_locked():
    assert locks.is_locked(_doc(), "beat-does-not-exist") is False


def test_locked_beats_in_scene_returns_locked_beat_with_scripttext():
    doc = _doc()
    locked = locks.locked_beats_in_scene(doc, "scene-1")
    assert [b["beatId"] for b in locked] == ["beat-1-2"]
    assert "OUTGOING TRANSFER" in locked[0]["scriptText"]  # constraint text present


def test_locked_beats_in_scene_empty_when_none_locked():
    assert locks.locked_beats_in_scene(_doc(), "scene-3") == []


def test_locked_beats_in_scene_honors_scene_cascade():
    doc = _doc()
    doc["seasons"][0]["episodes"][0]["scenes"][2]["locked"] = True  # scene-3
    locked = locks.locked_beats_in_scene(doc, "scene-3")
    assert [b["beatId"] for b in locked] == ["beat-3-1"]  # now locked by cascade


# ── write-side guard: assert_no_locked_writes (unit) ──────────────────────────


def _beat(doc, scene_idx, beat_idx):
    return doc["seasons"][0]["episodes"][0]["scenes"][scene_idx]["beats"][beat_idx]


def test_no_locked_writes_allows_an_untouched_doc():
    doc = _doc()
    locks.assert_no_locked_writes(doc, copy.deepcopy(doc))  # no raise


def test_no_locked_writes_rejects_editing_locked_beat_content():
    doc = _doc()
    new = copy.deepcopy(doc)
    _beat(new, 0, 1)["scriptText"] = "rewritten"  # beat-1-2 is locked
    try:
        locks.assert_no_locked_writes(doc, new)
        raise AssertionError("expected LockViolation")
    except locks.LockViolation:
        pass


def test_no_locked_writes_allows_unlock_flip_and_reindex_on_locked_beat():
    doc = _doc()
    new = copy.deepcopy(doc)
    beat = _beat(new, 0, 1)  # beat-1-2, locked + scriptLocked
    beat["scriptLocked"] = False  # unlock: the writer's own pin
    beat["locked"] = False
    beat["index"] = 9  # reindex: position, not content
    locks.assert_no_locked_writes(doc, new)  # no raise


def test_no_locked_writes_allows_insert_around_locked_beat_in_unlocked_scene():
    doc = _doc()
    new = copy.deepcopy(doc)
    scene1 = new["seasons"][0]["episodes"][0]["scenes"][0]  # unlocked scene
    scene1["beats"].append(
        {"id": "beat-1-9", "index": 2, "locked": False, "whatHappens": "x",
         "audienceLearns": "x", "audienceFeels": "x", "scriptText": "x", "scriptLocked": False}
    )
    locks.assert_no_locked_writes(doc, new)  # no raise: locked beat untouched


def test_no_locked_writes_rejects_adding_a_beat_to_a_locked_scene():
    doc = _doc()
    doc["seasons"][0]["episodes"][0]["scenes"][2]["locked"] = True  # lock scene-3
    new = copy.deepcopy(doc)
    new["seasons"][0]["episodes"][0]["scenes"][2]["beats"].append(
        {"id": "beat-3-9", "index": 1, "locked": False, "whatHappens": "x",
         "audienceLearns": "x", "audienceFeels": "x", "scriptText": "x", "scriptLocked": False}
    )
    try:
        locks.assert_no_locked_writes(doc, new)
        raise AssertionError("expected LockViolation")
    except locks.LockViolation:
        pass


def test_no_locked_writes_rejects_reordering_beats_inside_locked_scene():
    """Child ORDER check: permuting beats of a locked scene is LOCKED_OBJECT
    (ruling 2). Id-set unchanged; only order/index differs."""
    doc = _doc()
    doc["seasons"][0]["episodes"][0]["scenes"][0]["locked"] = True  # lock scene-1
    new = copy.deepcopy(doc)
    scene = new["seasons"][0]["episodes"][0]["scenes"][0]
    scene["beats"] = list(reversed(scene["beats"]))
    for i, beat in enumerate(scene["beats"]):
        beat["index"] = i
    try:
        locks.assert_no_locked_writes(doc, new)
        raise AssertionError("expected LockViolation")
    except locks.LockViolation:
        pass


def test_no_locked_writes_allows_reordering_beats_in_unlocked_scene():
    """Sibling reindex / reorder in an unlocked scene stays allowed."""
    doc = _doc()
    new = copy.deepcopy(doc)
    scene = new["seasons"][0]["episodes"][0]["scenes"][0]  # scene-1 unlocked
    scene["beats"] = list(reversed(scene["beats"]))
    for i, beat in enumerate(scene["beats"]):
        beat["index"] = i
    locks.assert_no_locked_writes(doc, new)  # no raise


def _scene(doc, scene_idx):
    return doc["seasons"][0]["episodes"][0]["scenes"][scene_idx]


def _swap_scene_index(doc, a, b):
    sa, sb = _scene(doc, a), _scene(doc, b)
    sa["index"], sb["index"] = sb["index"], sa["index"]


def test_no_locked_writes_rejects_moving_a_locked_scene_index():
    doc = _doc()
    _scene(doc, 2)["locked"] = True  # scene-3
    new = copy.deepcopy(doc)
    _swap_scene_index(new, 1, 2)  # scene-2 <-> scene-3
    with pytest.raises(locks.LockViolation, match="scene-3"):
        locks.assert_no_locked_writes(doc, new)


def test_no_locked_writes_rejects_moving_a_scene_index_in_a_locked_episode():
    doc = _doc()
    doc["seasons"][0]["episodes"][0]["locked"] = True
    new = copy.deepcopy(doc)
    _swap_scene_index(new, 0, 1)  # scene-1 <-> scene-2
    # The scene loop runs in array order, so scene-1 trips first.
    with pytest.raises(locks.LockViolation, match="scene-1"):
        locks.assert_no_locked_writes(doc, new)


def test_no_locked_writes_allows_reindexing_unlocked_scenes_beside_a_locked_one():
    doc = _doc()
    _scene(doc, 2)["locked"] = True  # scene-3
    new = copy.deepcopy(doc)
    _swap_scene_index(new, 0, 1)  # scene-1 <-> scene-2, both unlocked
    locks.assert_no_locked_writes(doc, new)  # no raise


# ── import guard: assert_import_target_writable (unit) ────────────────────────


def test_import_target_writable_rejects_locked_content():
    doc = _doc()  # fixture has locked beat-1-2
    try:
        locks.assert_import_target_writable(doc, [])
        raise AssertionError("expected LockViolation")
    except locks.LockViolation:
        pass


def test_import_target_writable_rejects_vouched_facts_even_when_unlocked():
    doc = _doc()
    for _e, _s, beat in locks._iter_beats(doc):
        beat["locked"] = beat["scriptLocked"] = False  # clear every lock
    ledger = [{"id": "fact-01", "status": "active"}]
    try:
        locks.assert_import_target_writable(doc, ledger)
        raise AssertionError("expected LockViolation")
    except locks.LockViolation:
        pass


def test_import_target_writable_allows_unlocked_pending_review_target():
    doc = _doc()
    for _e, _s, beat in locks._iter_beats(doc):
        beat["locked"] = beat["scriptLocked"] = False
    ledger = [{"id": "fact-01", "status": "pending_review"}]
    locks.assert_import_target_writable(doc, ledger)  # no raise
