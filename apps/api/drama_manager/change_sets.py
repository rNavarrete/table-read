"""Change Set create (T4.1) — Review mode step 1.

`POST /projects/{pid}/change-sets` runs `classify_blast_radius` (§3), then
server-annotates every impacted object with the fields the model never sets
(data contract §2a):

  - `applyMode`: scene/beat → regenerate; character/ledgerFact → flag_only
  - `locked` from the lock filter (drama_manager/locks.py — rule 2)
  - `before` snippets rendered from the current doc / ledger
  - `after: null` always at create time (and always for flag_only)
  - `continuityFlags` (empty at create; filled by regenerate in T4.2)
  - `approved: false`

The draft ChangeSet is persisted on `change_sets` and is **not**
snapshot-versioned (data contract §3). No project doc mutation happens here.

Logging is IDs + counts + PROMPT_VERSION only — never instruction / plan /
script / fact text (hard rule 5).
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

from drama_manager import locks, render
from llm.protocol import LlmClient
from schemas import ApplyMode, ChangeSet, ImpactedObjectType
from storage.models import ChangeSetRow, LedgerFactRow, ProjectRow

_logger = logging.getLogger("drama_manager.change_sets")

_REGENERATE_TYPES = frozenset(
    {ImpactedObjectType.scene.value, ImpactedObjectType.beat.value}
)
_FLAG_ONLY_TYPES = frozenset(
    {ImpactedObjectType.character.value, ImpactedObjectType.ledger_fact.value}
)


class TargetNotFound(LookupError):
    """`targetObjectId` is not a scene/beat/character/ledgerFact in the project
    (route → 404)."""


def _mint_change_set_id() -> str:
    """Server-assigned kebab id (clients never mint ids; CLAUDE.md conventions)."""
    return f"cs-{uuid.uuid4().hex}"


def _utcnow_iso() -> str:
    return datetime.now(UTC).replace(tzinfo=None).isoformat() + "Z"


def _iter_characters(doc: dict):
    yield from doc.get("seriesBible", {}).get("characters", [])


def _find_scene(doc: dict, object_id: str) -> dict | None:
    for _episode, scene in locks._iter_scenes(doc):
        if scene["id"] == object_id:
            return scene
    return None


def _find_beat(doc: dict, object_id: str) -> dict | None:
    for _episode, _scene, beat in locks._iter_beats(doc):
        if beat["id"] == object_id:
            return beat
    return None


def _find_character(doc: dict, object_id: str) -> dict | None:
    for character in _iter_characters(doc):
        if character.get("id") == object_id:
            return character
    return None


def validate_target(doc: dict, ledger: list[dict], target_object_id: str) -> None:
    """Validate the edit target before any LLM call. Raises `TargetNotFound`."""
    if (
        _find_scene(doc, target_object_id) is not None
        or _find_beat(doc, target_object_id) is not None
        or _find_character(doc, target_object_id) is not None
        or any(f.get("id") == target_object_id for f in ledger)
    ):
        return
    raise TargetNotFound(target_object_id)


def _compact_episode_plan(doc: dict) -> dict:
    """Compact episode plan for §3: scene/beat plan fields only (no scriptText)."""
    episodes = []
    for season in doc.get("seasons", []):
        for episode in season.get("episodes", []):
            scenes = []
            for scene in episode.get("scenes", []):
                scenes.append(
                    {
                        "id": scene["id"],
                        "index": scene.get("index"),
                        "act": scene.get("act"),
                        "locked": scene.get("locked", False),
                        "location": scene.get("location", ""),
                        "time": scene.get("time", ""),
                        "whatHappens": scene.get("whatHappens", ""),
                        "audienceLearns": scene.get("audienceLearns", ""),
                        "audienceFeels": scene.get("audienceFeels", ""),
                        "beats": [
                            {
                                "id": beat["id"],
                                "index": beat.get("index"),
                                "locked": beat.get("locked", False),
                                "scriptLocked": beat.get("scriptLocked", False),
                                "whatHappens": beat.get("whatHappens", ""),
                                "audienceLearns": beat.get("audienceLearns", ""),
                                "audienceFeels": beat.get("audienceFeels", ""),
                            }
                            for beat in scene.get("beats", [])
                        ],
                    }
                )
            episodes.append(
                {
                    "id": episode["id"],
                    "title": episode.get("title", ""),
                    "premise": episode.get("premise", ""),
                    "locked": episode.get("locked", False),
                    "scenes": scenes,
                }
            )
    return {"episodes": episodes}


def _active_facts(ledger: list[dict]) -> list[dict]:
    """Active facts as full objects for the §3 classifier input."""
    return [f for f in ledger if f.get("status") == "active"]


def _apply_mode(object_type: str) -> str:
    if object_type in _REGENERATE_TYPES:
        return ApplyMode.regenerate.value
    if object_type in _FLAG_ONLY_TYPES:
        return ApplyMode.flag_only.value
    # Unknown types should not reach here (BlastRadius schema constrains the
    # enum); treat as flag_only so we never offer a regenerate the backend
    # can't honor.
    return ApplyMode.flag_only.value


def _before_snippet(
    doc: dict, ledger_by_id: dict[str, dict], object_type: str, object_id: str
) -> str:
    """Render a display snippet from the current doc / ledger for the Review UI
    before-pane. Empty string if the object vanished between classify and
    annotate (shouldn't happen on a fresh create)."""
    if object_type == ImpactedObjectType.scene.value:
        scene = _find_scene(doc, object_id)
        if scene is None:
            return ""
        return scene.get("whatHappens") or scene.get("location") or ""
    if object_type == ImpactedObjectType.beat.value:
        beat = _find_beat(doc, object_id)
        if beat is None:
            return ""
        return beat.get("whatHappens") or beat.get("scriptText") or ""
    if object_type == ImpactedObjectType.character.value:
        character = _find_character(doc, object_id)
        if character is None:
            return ""
        return character.get("embodiment") or character.get("name") or ""
    if object_type == ImpactedObjectType.ledger_fact.value:
        fact = ledger_by_id.get(object_id)
        if fact is None:
            return ""
        return fact.get("fact") or ""
    return ""


def _annotate_impacted(doc: dict, ledger: list[dict], blast) -> list[dict]:
    """Turn a `BlastRadius` into server-annotated `ImpactedObject` wire dicts."""
    ledger_by_id = {f["id"]: f for f in ledger}
    out: list[dict] = []
    for hit in blast.impacted:
        object_type = hit.object_type.value
        object_id = hit.object_id
        apply_mode = _apply_mode(object_type)
        out.append(
            {
                "objectType": object_type,
                "objectId": object_id,
                "applyMode": apply_mode,
                "reason": hit.reason,
                "confidence": hit.confidence.value,
                "locked": locks.is_locked(doc, object_id),
                "before": _before_snippet(doc, ledger_by_id, object_type, object_id),
                "after": None,
                "continuityFlags": [],
                "approved": False,
            }
        )
    return out


def create_change_set(
    session,
    project: ProjectRow,
    *,
    target_object_id: str,
    instruction: str,
    llm: LlmClient,
) -> dict:
    """Classify blast radius, annotate, persist a draft ChangeSet, return it.

    Does not mutate the project doc or create a snapshot (data contract §3:
    change_sets are deliberately not versioned with the doc)."""
    doc = project.doc
    ledger = [
        row.to_wire_dict()
        for row in session.query(LedgerFactRow).filter_by(project_id=project.id).all()
    ]
    validate_target(doc, ledger, target_object_id)

    nonce = render.new_nonce()
    system, user = render.build_blast_radius_prompt(
        doc,
        episode_plan=_compact_episode_plan(doc),
        continuity_facts=_active_facts(ledger),
        target_object_id=target_object_id,
        instruction=instruction,
        nonce=nonce,
    )
    blast = llm.classify_blast_radius(
        system=system, user_message=user, prompt_version=render.PROMPT_VERSION
    )

    impacted = _annotate_impacted(doc, ledger, blast)
    change_set_id = _mint_change_set_id()
    change_set = {
        "id": change_set_id,
        "projectId": project.id,
        "instruction": instruction,
        "targetObjectId": target_object_id,
        "impacted": impacted,
        "preview": None,
        "status": "draft",
        "createdAt": _utcnow_iso(),
    }
    # Validate against the contract before persisting.
    ChangeSet.model_validate(change_set)

    session.add(
        ChangeSetRow(
            id=change_set_id,
            project_id=project.id,
            doc=change_set,
            status="draft",
        )
    )
    # Bump project.updated_at so the UI can notice a new draft without a
    # snapshot (change_sets aren't versioned). Keep the same naive-UTC
    # convention as storage/models._utcnow.
    project.updated_at = datetime.now(UTC).replace(tzinfo=None)
    session.commit()

    _logger.info(
        "change_set_created project_id=%s change_set_id=%s target=%s "
        "impacted_count=%d prompt_version=%s",
        project.id,
        change_set_id,
        target_object_id,
        len(impacted),
        render.PROMPT_VERSION,
    )
    return change_set
