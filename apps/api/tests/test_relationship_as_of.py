"""Unit tests for T7.25 relationship-state as-of helper (design doc
`docs/superpowers/specs/2026-07-16-time-aware-p1-remainder-design.md`
"T7.25 — Relationship state history": "Ledger/Web can show state as-of
scene via last state with sceneId <= k.")
"""

from __future__ import annotations

from drama_manager.relationship_as_of import latest_relationship_state

SCENES = [{"id": "scene-1"}, {"id": "scene-2"}, {"id": "scene-3"}]


def _state(scene_id: str, label: str, between=("char-a", "char-b")) -> dict:
    return {"between": list(between), "label": label, "sceneId": scene_id, "quote": ""}


def test_returns_none_when_no_states_for_the_pair():
    assert latest_relationship_state([], SCENES, ("char-a", "char-b"), "scene-3") is None


def test_returns_the_only_state_at_or_before_as_of():
    states = [_state("scene-1", "co-owners")]
    result = latest_relationship_state(states, SCENES, ("char-a", "char-b"), "scene-3")
    assert result is not None
    assert result["label"] == "co-owners"


def test_returns_latest_state_at_or_before_as_of_not_globally_latest():
    states = [
        _state("scene-1", "co-owners"),
        _state("scene-3", "estranged"),
    ]
    result = latest_relationship_state(states, SCENES, ("char-a", "char-b"), "scene-2")
    assert result is not None
    assert result["label"] == "co-owners"


def test_returns_none_when_all_states_are_after_as_of():
    states = [_state("scene-3", "estranged")]
    assert (
        latest_relationship_state(states, SCENES, ("char-a", "char-b"), "scene-1") is None
    )


def test_pair_order_is_insensitive():
    """`between` is an unordered pair -- (a, b) and (b, a) refer to the same
    relationship."""
    states = [_state("scene-1", "co-owners", between=("char-b", "char-a"))]
    result = latest_relationship_state(states, SCENES, ("char-a", "char-b"), "scene-1")
    assert result is not None
    assert result["label"] == "co-owners"


def test_ignores_states_for_a_different_pair():
    states = [
        _state("scene-1", "co-owners", between=("char-a", "char-b")),
        _state("scene-1", "rivals", between=("char-c", "char-d")),
    ]
    result = latest_relationship_state(states, SCENES, ("char-a", "char-b"), "scene-3")
    assert result is not None
    assert result["label"] == "co-owners"


def test_picks_latest_among_multiple_states_at_or_before_as_of():
    states = [
        _state("scene-1", "acquaintances"),
        _state("scene-2", "co-owners"),
    ]
    result = latest_relationship_state(states, SCENES, ("char-a", "char-b"), "scene-3")
    assert result is not None
    assert result["label"] == "co-owners"


def test_orphan_scene_id_on_a_state_is_ignored():
    states = [_state("scene-does-not-exist", "co-owners")]
    result = latest_relationship_state(states, SCENES, ("char-a", "char-b"), "scene-3")
    assert result is None


def test_unknown_as_of_scene_id_raises_key_error():
    try:
        latest_relationship_state([], SCENES, ("char-a", "char-b"), "scene-does-not-exist")
        raise AssertionError("expected KeyError")
    except KeyError:
        pass
