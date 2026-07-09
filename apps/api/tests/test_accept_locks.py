"""Lock enforcement for beat insertion — the write-side of CLAUDE.md rule 2.

Authored and committed BEFORE the accept feature tests (rule 2's ordering): the
beat-accept path inserts a NEW beat and must never modify existing locked beat
*content*. `drama_manager.locks.insert_beat` is the single lock-safe insertion
path both the pipeline and the route go through.
"""

from __future__ import annotations

import copy

import pytest

from drama_manager import locks
from storage.seed import load_fixture


def _doc() -> dict:
    return load_fixture()["project"]


def _new_beat(beat_id: str = "beat-new") -> dict:
    return {
        "id": beat_id,
        "index": 0,
        "locked": False,
        "whatHappens": "A new beat lands.",
        "audienceLearns": "Something new.",
        "audienceFeels": "Curiosity.",
        "scriptText": "MARTA\nAnd one more thing.",
        "scriptLocked": False,
    }


# ── the non-negotiable: inserting next to a locked beat preserves its content ──


def test_insert_after_sibling_shifts_locked_beat_but_content_byte_identical():
    doc = _doc()
    # scene-1: beat-1-1 (unlocked, idx 0), beat-1-2 (locked + scriptLocked, idx 1)
    scene1 = doc["seasons"][0]["episodes"][0]["scenes"][0]
    locked_before = copy.deepcopy(next(b for b in scene1["beats"] if b["id"] == "beat-1-2"))
    assert locked_before["locked"] and locked_before["scriptLocked"]

    new_doc = locks.insert_beat(doc, "scene-1", "beat-1-1", _new_beat())

    new_scene1 = new_doc["seasons"][0]["episodes"][0]["scenes"][0]
    ids = [b["id"] for b in new_scene1["beats"]]
    assert ids == ["beat-1-1", "beat-new", "beat-1-2"]  # inserted after beat-1-1

    locked_after = next(b for b in new_scene1["beats"] if b["id"] == "beat-1-2")
    # index shifted 1 -> 2 (allowed: structural, not content)
    assert locked_before["index"] == 1 and locked_after["index"] == 2
    # every content field byte-identical
    for field in locks._BEAT_CONTENT_FIELDS:
        assert locked_after[field] == locked_before[field]


def test_insert_does_not_mutate_input_doc():
    doc = _doc()
    before = copy.deepcopy(doc)
    locks.insert_beat(doc, "scene-1", "beat-1-1", _new_beat())
    assert doc == before  # pure: input untouched


# ── locked scene / episode are structurally frozen ───────────────────────────


def test_insert_into_locked_scene_raises():
    doc = _doc()
    doc["seasons"][0]["episodes"][0]["scenes"][0]["locked"] = True
    with pytest.raises(locks.LockViolation):
        locks.insert_beat(doc, "scene-1", "beat-1-1", _new_beat())


def test_insert_under_locked_episode_raises():
    doc = _doc()
    doc["seasons"][0]["episodes"][0]["locked"] = True
    with pytest.raises(locks.LockViolation):
        locks.insert_beat(doc, "scene-1", "beat-1-1", _new_beat())


# ── plain reindex behaviour (top-of-scene + tail insert) ─────────────────────


def test_insert_at_top_of_scene_reindexes():
    doc = _doc()
    new_doc = locks.insert_beat(doc, "scene-3", None, _new_beat())
    beats = new_doc["seasons"][0]["episodes"][0]["scenes"][2]["beats"]
    assert [b["id"] for b in beats] == ["beat-new", "beat-3-1"]
    assert [b["index"] for b in beats] == [0, 1]


def test_bad_after_beat_id_raises_valueerror():
    doc = _doc()
    with pytest.raises(ValueError):
        locks.insert_beat(doc, "scene-3", "beat-nope", _new_beat())


def test_unknown_scene_raises_valueerror():
    doc = _doc()
    with pytest.raises(ValueError):
        locks.insert_beat(doc, "scene-999", None, _new_beat())
