"""One-off T9.3 migration: list published fallback scene turns as unanalysed.

Before analysis 3.6 a scene that failed its read was published with
server-written fallback prose. This finds every scene in a prior run's
`fallbackSceneIds` whose published sceneTurn still carries that run's fallback
`turn`, removes the turn and lists the scene in `unanalyzedSceneIds`, through
`snapshots.mutate`. Dry run by default; prints ids and counts only (rule 5).

    DATABASE_URL=sqlite:////path/to/copy.db python -m storage.convert_fallback_turns [--apply]
"""

from __future__ import annotations

import copy
import sys

from sqlalchemy.orm import Session

from storage import snapshots
from storage.models import NarrativeMapRunRow, ProjectRow


def _fallback_turns(session: Session, project_id: str) -> dict[str, set[str]]:
    """Scene id -> every fallback `turn` text a prior run recorded for it."""
    turns: dict[str, set[str]] = {}
    for run in session.query(NarrativeMapRunRow).filter_by(project_id=project_id):
        checkpoint = run.checkpoint or {}
        fallback_ids = set(checkpoint.get("fallbackSceneIds") or [])
        for packet in checkpoint.get("scenePackets") or []:
            if isinstance(packet, dict) and packet.get("sceneId") in fallback_ids:
                turns.setdefault(packet["sceneId"], set()).add(packet.get("turn"))
    return turns


def _convert(doc: dict, fallback_turns: dict[str, set[str]]) -> list[str]:
    """Move fallback turns to `unanalyzedSceneIds` in place; return the scene ids."""
    converted: list[str] = []
    for season in doc.get("seasons") or []:
        for episode in season.get("episodes") or []:
            narrative_map = episode.get("narrativeMap")
            if not narrative_map or episode.get("locked") or narrative_map.get("locked"):
                continue
            turns = narrative_map.get("sceneTurns") or []
            stale = [
                turn["sceneId"]
                for turn in turns
                if turn.get("turn") in fallback_turns.get(turn.get("sceneId"), ())
            ]
            # sceneTurns may not be empty; a map that is fallback throughout stays.
            if not stale or len(stale) == len(turns):
                continue
            narrative_map["sceneTurns"] = [t for t in turns if t["sceneId"] not in stale]
            narrative_map["unanalyzedSceneIds"] = [
                *(narrative_map.get("unanalyzedSceneIds") or []),
                *stale,
            ]
            converted.extend(stale)
    return converted


def convert_fallback_turns(session: Session, project_id: str, *, apply: bool = False) -> list[str]:
    """Return the scene ids converted (or, on a dry run, that would be)."""
    fallback_turns = _fallback_turns(session, project_id)
    project = session.get(ProjectRow, project_id)
    converted = _convert(copy.deepcopy(project.doc), fallback_turns)
    if apply and converted:

        def mutator(state: snapshots.MutationState) -> snapshots.MutationState:
            doc = copy.deepcopy(state.doc)
            _convert(doc, fallback_turns)
            return snapshots.MutationState(
                doc=doc, ledger=state.ledger, flags=state.flags, snapshot_id=state.snapshot_id
            )

        snapshots.mutate(session, project_id, "Mark fallback scene turns unanalysed", mutator)
    return converted


if __name__ == "__main__":
    from storage.db import DATABASE_URL, SessionLocal

    apply = "--apply" in sys.argv[1:]
    print(f"{'APPLY' if apply else 'DRY RUN'} against {DATABASE_URL}")
    with SessionLocal() as session:
        for (project_id,) in session.query(ProjectRow.id).all():
            converted = convert_fallback_turns(session, project_id, apply=apply)
            print(f"{project_id}: {len(converted)} fallback scene turns -> unanalysed")
