"""A moved head is not a changed script.

`snapshots.mutate(expected_head_snapshot_id=...)` is the right guard for "the
writer edited the script while the map was being verified", but a moved head
does not by itself mean that — and saving a map moves the head. That made a
completed run impossible to repair again: the retry raced its own output and
was reported to the writer as a script change they never made.
"""

from __future__ import annotations

import copy

from drama_manager import narrative_map_runs
from drama_manager.narrative_map_analysis import prepare_narrative_map_source
from storage import snapshots
from storage.models import NarrativeMapRunRow, ProjectRow, SnapshotRow

MAP = {
    "dramaticQuestion": "Will Marta confront Dan?",
    "centralConflict": "Marta needs the truth; Dan needs it buried.",
    "controllingIdea": "Truth costs the thing it protects.",
    "themes": [],
    "acts": [],
    "heroJourney": {"applies": False, "protagonistName": None, "rationale": "n/a", "stages": []},
    "characterArcs": [],
    "sceneTurns": [],
    "threadMovements": [],
    "provenance": "inferred",
    "locked": False,
}


def _make_map_ready(db_session, project_id: str) -> None:
    """Every beat needs source text before a map can be grounded in it."""

    def mutator(state: snapshots.MutationState) -> snapshots.MutationState:
        doc = copy.deepcopy(state.doc)
        for season in doc.get("seasons", []):
            for episode in season.get("episodes", []):
                for scene in episode.get("scenes", []):
                    if not scene.get("beats"):
                        scene["beats"] = [
                            {
                                "id": f"{scene['id']}-b1",
                                "index": 0,
                                "locked": False,
                                "whatHappens": "",
                                "audienceLearns": "",
                                "audienceFeels": "",
                                "scriptText": "",
                                "scriptLocked": False,
                            }
                        ]
                    for index, beat in enumerate(scene.get("beats", []), start=1):
                        if not str(beat.get("scriptText") or "").strip():
                            beat["scriptText"] = f"{scene['location']}\nBeat {index} action."
        return snapshots.MutationState(doc=doc, ledger=state.ledger, flags=state.flags)

    snapshots.mutate(db_session, project_id, "Fill source text", mutator)


def _setup(db_session, unlocked_project, tag: str):
    project = db_session.get(ProjectRow, unlocked_project["project"]["id"])
    _make_map_ready(db_session, project.id)
    db_session.refresh(project)
    source_doc = copy.deepcopy(project.doc)
    source = prepare_narrative_map_source(source_doc)
    run = NarrativeMapRunRow(
        id=f"nmap-test-{tag}",
        project_id=project.id,
        run_key=f"{project.id}:{tag}:{source.source_hash}",
        source_snapshot_id=project.head_snapshot_id,
        source_hash=source.source_hash,
        analysis_version=narrative_map_runs.NARRATIVE_MAP_ANALYSIS_VERSION,
        status="running",
        phase="saving",
        attempt_count=1,
        checkpoint={},
    )
    db_session.add(run)
    db_session.commit()
    mapped_doc = copy.deepcopy(source_doc)
    episode = mapped_doc["seasons"][0]["episodes"][0]
    episode["narrativeMap"] = copy.deepcopy(MAP)
    return project, run, source, mapped_doc


def _move_head(db_session, project_id: str, title: str) -> None:
    """Move the head without touching format, cast or scenes."""

    def mutator(state: snapshots.MutationState) -> snapshots.MutationState:
        doc = copy.deepcopy(state.doc)
        doc["title"] = title
        return snapshots.MutationState(doc=doc, ledger=state.ledger, flags=state.flags)

    snapshots.mutate(db_session, project_id, "Retitle", mutator)


def test_map_applies_when_the_head_moved_but_the_script_did_not(
    db_session, unlocked_project
):
    project, run, source, mapped_doc = _setup(db_session, unlocked_project, "moved")
    _move_head(db_session, project.id, "Renamed mid-run")

    snapshot = narrative_map_runs._apply_to_moved_head(db_session, run, source, mapped_doc)

    assert snapshot is not None, "an unchanged script must not be reported as stale"
    episode = snapshot.doc["seasons"][0]["episodes"][0]
    assert episode["narrativeMap"]["centralConflict"] == MAP["centralConflict"]
    # The map lands on the live document, not the stale copy it was built from.
    assert snapshot.doc["title"] == "Renamed mid-run"
    assert run.source_snapshot_id == snapshot.id, "later retries compare against the new head"


def test_map_is_refused_when_the_script_actually_changed(db_session, unlocked_project):
    project, run, source, mapped_doc = _setup(db_session, unlocked_project, "changed")

    def mutator(state: snapshots.MutationState) -> snapshots.MutationState:
        doc = copy.deepcopy(state.doc)
        doc["seasons"][0]["episodes"][0]["scenes"][0]["beats"][0]["scriptText"] += "\nNew line."
        return snapshots.MutationState(doc=doc, ledger=state.ledger, flags=state.flags)

    snapshots.mutate(db_session, project.id, "Edit the script", mutator)

    assert narrative_map_runs._apply_to_moved_head(db_session, run, source, mapped_doc) is None


def test_a_lock_that_appeared_meanwhile_refuses_the_map(db_session, unlocked_project):
    project, run, source, mapped_doc = _setup(db_session, unlocked_project, "locked")

    def mutator(state: snapshots.MutationState) -> snapshots.MutationState:
        doc = copy.deepcopy(state.doc)
        doc["seasons"][0]["episodes"][0]["locked"] = True
        return snapshots.MutationState(doc=doc, ledger=state.ledger, flags=state.flags)

    snapshots.mutate(db_session, project.id, "Lock the episode", mutator)

    assert narrative_map_runs._apply_to_moved_head(db_session, run, source, mapped_doc) is None


def test_head_snapshot_row_missing_refuses_rather_than_raising(
    db_session, unlocked_project
):
    project, run, source, mapped_doc = _setup(db_session, unlocked_project, "nohead")
    db_session.delete(db_session.get(SnapshotRow, project.head_snapshot_id))
    db_session.commit()

    assert narrative_map_runs._apply_to_moved_head(db_session, run, source, mapped_doc) is None
