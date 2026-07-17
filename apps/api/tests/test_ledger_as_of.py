"""Pure temporal filter for the ledger (T7.18 P1 slice 1, design doc
`docs/superpowers/specs/2026-07-16-time-aware-ledger-design.md`).

Status filtering is explicitly out of scope here — the route layer applies
it after this temporal filter (design doc "Semantics" / task brief). These
tests only exercise the establishing-scene-index and supersede-chain rules.
"""

from __future__ import annotations

from drama_manager.ledger_as_of import facts_as_of

SCENES = [{"id": "scene-1"}, {"id": "scene-2"}, {"id": "scene-3"}]


def _fact(fact_id: str, scene_id: str, *, superseded_by: str | None = None) -> dict:
    return {
        "id": fact_id,
        "sourceSpan": {"sceneId": scene_id},
        "supersededBy": superseded_by,
    }


def test_fact_established_at_or_before_as_of_is_included():
    ledger = [_fact("fact-01", "scene-1")]
    assert facts_as_of(SCENES, ledger, "scene-2") == ledger


def test_fact_established_later_than_as_of_is_excluded():
    ledger = [_fact("fact-01", "scene-3")]
    assert facts_as_of(SCENES, ledger, "scene-1") == []


def test_superseded_after_as_of_still_included():
    fact = _fact("fact-01", "scene-1", superseded_by="fact-02")
    superseder = _fact("fact-02", "scene-3")
    result = facts_as_of(SCENES, [fact, superseder], "scene-2")
    assert [f["id"] for f in result] == ["fact-01"]


def test_superseded_at_or_before_as_of_is_excluded():
    fact = _fact("fact-01", "scene-1", superseded_by="fact-02")
    superseder = _fact("fact-02", "scene-3")
    result = facts_as_of(SCENES, [fact, superseder], "scene-3")
    assert [f["id"] for f in result] == ["fact-02"]


def test_orphan_source_span_scene_is_excluded():
    ledger = [_fact("fact-01", "scene-does-not-exist")]
    assert facts_as_of(SCENES, ledger, "scene-3") == []


def test_unknown_as_of_scene_id_raises_key_error():
    try:
        facts_as_of(SCENES, [], "scene-does-not-exist")
        raise AssertionError("expected KeyError")
    except KeyError:
        pass


def test_status_is_not_filtered_here():
    """Temporal-only: a rejected/stale fact established in time is still
    returned — the route applies status filtering after this helper."""
    ledger = [
        {
            "id": "fact-01",
            "sourceSpan": {"sceneId": "scene-1"},
            "status": "rejected",
            "supersededBy": None,
        }
    ]
    result = facts_as_of(SCENES, ledger, "scene-1")
    assert [f["id"] for f in result] == ["fact-01"]
