"""T9.3 one-off migration: published fallback scene turns become unanalysed."""

from __future__ import annotations

import copy

import pytest

from storage import snapshots
from storage.convert_fallback_turns import convert_fallback_turns
from storage.models import NarrativeMapRunRow, ProjectRow, SnapshotRow


def _turn(scene_id: str, text: str) -> dict:
    return {
        "sceneId": scene_id,
        "focalCharacterId": None,
        "dramaticFunction": text,
        "conflict": text,
        "stakes": text,
        "turnBeatId": f"{scene_id}-b1",
        "turn": text,
        "evidenceQuote": "Quote.",
    }


def _publish(
    db_session,
    project_id: str,
    turns: list[dict],
    *,
    locked: bool = False,
    episode_locked: bool = False,
) -> str:
    def mutator(state: snapshots.MutationState) -> snapshots.MutationState:
        doc = copy.deepcopy(state.doc)
        doc["seasons"][0]["episodes"][0]["locked"] = episode_locked
        doc["seasons"][0]["episodes"][0]["narrativeMap"] = {
            "sceneTurns": turns,
            "locked": locked,
        }
        return snapshots.MutationState(doc=doc, ledger=state.ledger, flags=state.flags)

    return snapshots.mutate(db_session, project_id, "Publish map", mutator).id


def _fallback_run(db_session, project_id: str, run_id: str, packets: list[dict]) -> None:
    db_session.add(
        NarrativeMapRunRow(
            id=run_id,
            project_id=project_id,
            run_key=f"{project_id}:{run_id}",
            source_snapshot_id=db_session.get(ProjectRow, project_id).head_snapshot_id,
            source_hash="h",
            analysis_version="2.5",
            status="failed",
            phase="failed",
            attempt_count=1,
            checkpoint={
                "fallbackSceneIds": [packet["sceneId"] for packet in packets],
                "scenePackets": packets,
            },
        )
    )
    db_session.commit()


def test_published_fallback_turn_becomes_unanalyzed_only_when_applied(db_session, unlocked_project):
    project_id = unlocked_project["project"]["id"]
    scenes = unlocked_project["project"]["seasons"][0]["episodes"][0]["scenes"]
    a, b, c = (scene["id"] for scene in scenes[:3])
    # b still shows its fallback prose; c fell back once but has been analysed since.
    _fallback_run(
        db_session,
        project_id,
        "nmap-t93-convert",
        [{"sceneId": b, "turn": "Connective boilerplate."}, {"sceneId": c, "turn": "Old."}],
    )
    head = _publish(
        db_session,
        project_id,
        [_turn(a, "Real analysis."), _turn(b, "Connective boilerplate."), _turn(c, "New.")],
    )

    assert convert_fallback_turns(db_session, project_id) == [b]
    assert db_session.get(ProjectRow, project_id).head_snapshot_id == head, "dry run writes"

    assert convert_fallback_turns(db_session, project_id, apply=True) == [b]
    project = db_session.get(ProjectRow, project_id)
    narrative_map = project.doc["seasons"][0]["episodes"][0]["narrativeMap"]
    assert [turn["sceneId"] for turn in narrative_map["sceneTurns"]] == [a, c]
    assert narrative_map["unanalyzedSceneIds"] == [b]
    assert db_session.get(SnapshotRow, project.head_snapshot_id).parent_id == head
    assert convert_fallback_turns(db_session, project_id) == []

    db_session.delete(db_session.get(NarrativeMapRunRow, "nmap-t93-convert"))
    db_session.commit()


@pytest.mark.parametrize("lock", ["episode", "narrativeMap"])
def test_locked_map_is_left_alone(db_session, unlocked_project, lock):
    project_id = unlocked_project["project"]["id"]
    a, b = (
        scene["id"]
        for scene in unlocked_project["project"]["seasons"][0]["episodes"][0]["scenes"][:2]
    )
    _fallback_run(
        db_session, project_id, f"nmap-t93-locked-{lock}", [{"sceneId": b, "turn": "Boilerplate."}]
    )
    head = _publish(
        db_session,
        project_id,
        [_turn(a, "Real analysis."), _turn(b, "Boilerplate.")],
        locked=lock == "narrativeMap",
        episode_locked=lock == "episode",
    )

    assert convert_fallback_turns(db_session, project_id, apply=True) == []
    assert db_session.get(ProjectRow, project_id).head_snapshot_id == head

    db_session.delete(db_session.get(NarrativeMapRunRow, f"nmap-t93-locked-{lock}"))
    db_session.commit()


def test_wholly_fallback_map_is_left_alone(db_session, unlocked_project):
    project_id = unlocked_project["project"]["id"]
    scene = unlocked_project["project"]["seasons"][0]["episodes"][0]["scenes"][0]["id"]
    _fallback_run(
        db_session, project_id, "nmap-t93-alone", [{"sceneId": scene, "turn": "Boilerplate."}]
    )
    # sceneTurns may not be empty, so a map that is fallback throughout stays as it is.
    _publish(db_session, project_id, [_turn(scene, "Boilerplate.")])
    assert convert_fallback_turns(db_session, project_id, apply=True) == []

    db_session.delete(db_session.get(NarrativeMapRunRow, "nmap-t93-alone"))
    db_session.commit()
