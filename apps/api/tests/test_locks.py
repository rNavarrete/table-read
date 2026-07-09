"""Read-side lock filter (CLAUDE.md hard rule 2, test plan line 16).

Covers the episode→scene→beat cascade and the locked-beat constraint surface
the candidate bundle depends on.
"""

from __future__ import annotations

import copy

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
