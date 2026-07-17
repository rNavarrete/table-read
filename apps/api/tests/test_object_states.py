"""Unit tests for T7.26 object custody / location continuity (design doc
`docs/superpowers/specs/2026-07-16-time-aware-p1-remainder-design.md`
"T7.26 — Object custody / location continuity", simpler-MVP path).

`infer_object_states` and `detect_object_conflicts` are pure and
deterministic -- no LLM. `infer_object_states` reads already-extracted
ledger fact text (`extract_ledger_facts` output); `detect_object_conflicts`
flags a later state whose location disagrees with the same object's most
recent earlier state.
"""

from __future__ import annotations

from fountain.object_states import detect_object_conflicts, infer_object_states

SCENES = [{"id": "scene-1"}, {"id": "scene-2"}, {"id": "scene-3"}]


def _fact(fact_type: str, text: str, scene_id: str = "scene-1") -> dict:
    return {
        "factType": fact_type,
        "fact": text,
        "sourceSpan": {"sceneId": scene_id},
    }


class TestInferObjectStates:
    def test_extracts_hidden_in_location(self):
        facts = [
            _fact(
                "state",
                "The stolen $40,000 is hidden inside the bar's basement ice machine",
                "scene-2",
            )
        ]
        states = infer_object_states(facts)
        assert states == [
            {
                "name": "The stolen $40,000",
                "holderCharacterId": None,
                "locationLabel": "the bar's basement ice machine",
                "sceneId": "scene-2",
                "quote": (
                    "The stolen $40,000 is hidden inside the bar's "
                    "basement ice machine"
                ),
            }
        ]

    def test_extracts_kept_at_and_stored_under(self):
        facts = [
            _fact("state", "The ledger is kept at the back office"),
            _fact("event", "The gun was stored under the floorboard"),
        ]
        states = infer_object_states(facts)
        assert [s["name"] for s in states] == ["The ledger", "The gun"]
        assert [s["locationLabel"] for s in states] == [
            "the back office",
            "the floorboard",
        ]

    def test_ignores_facts_that_are_not_state_or_event(self):
        facts = [
            _fact(
                "knowledge", "The bag is hidden in the trunk"
            ),
        ]
        assert infer_object_states(facts) == []

    def test_ignores_facts_without_a_custody_phrase(self):
        facts = [_fact("state", "Marta has been away for eight years")]
        assert infer_object_states(facts) == []

    def test_ignores_fact_with_missing_scene_id(self):
        fact = _fact("state", "The gun is hidden in the drawer")
        fact["sourceSpan"] = {}
        assert infer_object_states([fact]) == []

    def test_case_insensitive_verb_match(self):
        facts = [_fact("state", "the money WAS HIDDEN AT the marina")]
        states = infer_object_states(facts)
        assert states[0]["locationLabel"] == "the marina"


class TestDetectObjectConflicts:
    def _state(self, name, location, scene_id, quote="q"):
        return {
            "name": name,
            "holderCharacterId": None,
            "locationLabel": location,
            "sceneId": scene_id,
            "quote": quote,
        }

    def test_no_conflict_for_a_single_state(self):
        states = [self._state("The bag", "the ice machine", "scene-1")]
        assert detect_object_conflicts(states, SCENES) == []

    def test_no_conflict_when_location_is_unchanged(self):
        states = [
            self._state("The bag", "the ice machine", "scene-1"),
            self._state("the bag", "the ice machine", "scene-2"),
        ]
        assert detect_object_conflicts(states, SCENES) == []

    def test_flags_a_later_state_with_a_different_location(self):
        states = [
            self._state("The bag", "the ice machine", "scene-1", quote="q1"),
            self._state("The bag", "the marina locker", "scene-3", quote="q2"),
        ]
        flags = detect_object_conflicts(states, SCENES)
        assert len(flags) == 1
        flag = flags[0]
        assert flag["objectType"] == "scene"
        assert flag["objectId"] == "scene-3"
        assert flag["factId"] is None
        assert flag["severity"] == "tension"
        assert "ice machine" in flag["explanation"]
        assert "marina locker" in flag["explanation"]

    def test_conflicts_are_scoped_per_object_name(self):
        states = [
            self._state("The bag", "the ice machine", "scene-1"),
            self._state("The gun", "the drawer", "scene-1"),
            self._state("The gun", "the trunk", "scene-2"),
        ]
        flags = detect_object_conflicts(states, SCENES)
        assert len(flags) == 1
        assert flags[0]["objectId"] == "scene-2"

    def test_object_name_matching_ignores_leading_article_and_case(self):
        states = [
            self._state("the Bag", "the ice machine", "scene-1"),
            self._state("The BAG", "the marina locker", "scene-2"),
        ]
        flags = detect_object_conflicts(states, SCENES)
        assert len(flags) == 1

    def test_states_out_of_input_order_are_compared_in_scene_order(self):
        states = [
            self._state("The bag", "the marina locker", "scene-3"),
            self._state("The bag", "the ice machine", "scene-1"),
        ]
        flags = detect_object_conflicts(states, SCENES)
        assert len(flags) == 1
        assert flags[0]["objectId"] == "scene-3"

    def test_empty_states_returns_empty(self):
        assert detect_object_conflicts([], SCENES) == []
