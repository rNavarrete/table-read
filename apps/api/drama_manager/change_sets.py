"""Change Set create / preview / apply / discard / flag (T4.1 + T4.2).

`POST /projects/{pid}/change-sets` (T4.1) runs `classify_blast_radius` (§3),
then server-annotates every impacted object with the fields the model never
sets (data contract §2a):

  - `applyMode`: scene/beat → regenerate; character/ledgerFact → flag_only
  - `locked` from the lock filter (drama_manager/locks.py — rule 2)
  - `before` snippets rendered from the current doc / ledger
  - `after: null` always at create time (and always for flag_only)
  - `continuityFlags` (empty at create; filled by regenerate in T4.2)
  - `approved: false`

`POST /change-sets/{cid}/preview` (T4.2) runs `regenerate_elements` (§4) for
the approved regenerate targets, stores a typed `ChangeSetPreview`
(`basedOnSnapshotId` = current head), and renders `after` display snippets
from the typed payload. Does **not** mutate the project doc.

`POST /change-sets/{cid}/apply` writes the stored preview payload verbatim
(zero `regenerate_elements` calls), approved-only, then snapshots, re-extracts
ledger, and runs `scan_consistency` over untouched scenes (§8c). Locked /
`flag_only` ids, null preview, or stale `basedOnSnapshotId` → 409.

`POST /change-sets/{cid}/discard` / `flag` flip status only — no project
mutation (needed by Review UI Agent E).

Change sets themselves are **not** snapshot-versioned (data contract §3).
Logging is IDs + counts + PROMPT_VERSION only — never instruction / plan /
script / fact text (hard rule 5).
"""

from __future__ import annotations

import copy
import logging
import uuid
from datetime import UTC, datetime

from drama_manager import ledger_filter, ledger_policy, locks, render, scan
from drama_manager.ledger_filter import RelevanceContext
from llm.errors import SchemaInvalidLlmError
from llm.protocol import LlmClient
from schemas import (
    ApplyMode,
    ChangeSet,
    ChangeSetPreview,
    ImpactedObjectType,
    RegeneratedElements,
)
from storage import snapshots
from storage.models import (
    ChangeSetRow,
    ConsistencyFlagRow,
    LedgerFactRow,
    ProjectRow,
)

_logger = logging.getLogger("drama_manager.change_sets")

_REGENERATE_TYPES = frozenset(
    {ImpactedObjectType.scene.value, ImpactedObjectType.beat.value}
)
_FLAG_ONLY_TYPES = frozenset(
    {ImpactedObjectType.character.value, ImpactedObjectType.ledger_fact.value}
)

_SCENE_FIELD_WIRE = (
    ("whatHappens", "what_happens"),
    ("audienceLearns", "audience_learns"),
    ("audienceFeels", "audience_feels"),
    ("location", "location"),
    ("time", "time"),
    ("socialSituation", "social_situation"),
)


class TargetNotFound(LookupError):
    """`targetObjectId` is not a scene/beat/character/ledgerFact in the project
    (route → 404)."""


class ChangeSetNotFound(LookupError):
    """Change set id is unknown (route → 404)."""


class ApplyRejected(Exception):
    """Apply / preview preconditions failed (route → 409 with `.code`)."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


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


def _locate_beat(doc: dict, beat_id: str) -> tuple[dict, dict, dict] | None:
    for episode, scene, beat in locks._iter_beats(doc):
        if beat["id"] == beat_id:
            return episode, scene, beat
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


def _get_change_set_row(session, change_set_id: str) -> ChangeSetRow:
    row = session.get(ChangeSetRow, change_set_id)
    if row is None:
        raise ChangeSetNotFound(change_set_id)
    return row


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


# ── T4.2 preview / apply / discard / flag ─────────────────────────────────────


def _impacted_by_id(change_set: dict) -> dict[str, dict]:
    return {row["objectId"]: row for row in change_set["impacted"]}


def _resolve_approved_regenerate_targets(
    change_set: dict, approved_object_ids: list[str], doc: dict
) -> list[str]:
    """Validate approved ids for preview/apply regenerate targets.

    Raises `ApplyRejected` for locked or flag_only ids (route → 409). Unknown
    ids (not in the ChangeSet's impacted list) → `ApplyRejected(VALIDATION)`.
    Returns the ordered list of regenerate-mode ids that are approved."""
    by_id = _impacted_by_id(change_set)
    regenerate_ids: list[str] = []
    for object_id in approved_object_ids:
        hit = by_id.get(object_id)
        if hit is None:
            raise ApplyRejected(
                "VALIDATION", f"objectId {object_id!r} is not in this ChangeSet"
            )
        if hit["applyMode"] == ApplyMode.flag_only.value:
            raise ApplyRejected(
                "VALIDATION",
                f"objectId {object_id!r} is flag_only and cannot be applied",
            )
        if hit.get("locked") or locks.is_locked(doc, object_id):
            raise ApplyRejected(
                "LOCKED_OBJECT", f"objectId {object_id!r} is locked"
            )
        regenerate_ids.append(object_id)
    return regenerate_ids


def _neighbor_scene_summaries(doc: dict, regenerate_ids: set[str]) -> list[dict]:
    """Plan summaries of scenes that are *not* being regenerated (§4)."""
    out: list[dict] = []
    for _episode, scene in locks._iter_scenes(doc):
        if scene["id"] in regenerate_ids:
            continue
        out.append(
            {
                "id": scene["id"],
                "location": scene.get("location", ""),
                "whatHappens": scene.get("whatHappens", ""),
            }
        )
    return out


def _locked_siblings_for_regenerate(doc: dict, regenerate_ids: set[str]) -> list[dict]:
    """Locked beats that share a scene with any regenerate target (§4)."""
    scene_ids: set[str] = set()
    for object_id in regenerate_ids:
        if _find_scene(doc, object_id) is not None:
            scene_ids.add(object_id)
        else:
            located = _locate_beat(doc, object_id)
            if located is not None:
                scene_ids.add(located[1]["id"])
    locked: list[dict] = []
    seen: set[str] = set()
    for scene_id in scene_ids:
        for beat in locks.locked_beats_in_scene(doc, scene_id):
            if beat["beatId"] in regenerate_ids or beat["beatId"] in seen:
                continue
            seen.add(beat["beatId"])
            locked.append(beat)
    return locked


def _validate_regenerated_ids(
    regenerated: RegeneratedElements, allowed_ids: set[str]
) -> None:
    """Reject extra beat/scene ids not in the approved regenerate set.

    Raises `SchemaInvalidLlmError` after logging the offending ids only
    (hard rule 5 — never log plan/script text)."""
    returned: set[str] = set()
    for beat in regenerated.beats:
        returned.add(beat.beat_id)
    for scene in regenerated.scenes:
        returned.add(scene.scene_id)
    extras = sorted(returned - allowed_ids)
    if extras:
        _logger.info(
            "regenerate_elements_extra_ids rejected_ids=%s allowed_ids=%s",
            extras,
            sorted(allowed_ids),
        )
        raise SchemaInvalidLlmError("regenerate_elements")


def _preview_wire_from_regenerated(
    regenerated: RegeneratedElements, based_on_snapshot_id: str
) -> dict:
    preview = {
        "beatUpdates": [
            b.model_dump(by_alias=True, mode="json") for b in regenerated.beats
        ],
        "sceneUpdates": [
            s.model_dump(by_alias=True, mode="json") for s in regenerated.scenes
        ],
        "continuityConflicts": [
            c.model_dump(by_alias=True, mode="json")
            for c in regenerated.continuity_conflicts
        ],
        "basedOnSnapshotId": based_on_snapshot_id,
        "generatedAt": _utcnow_iso(),
    }
    ChangeSetPreview.model_validate(preview)
    return preview


def _annotate_after_from_preview(change_set: dict, preview: dict) -> None:
    """Fill `after` display snippets + continuityFlags from the typed preview.

    Mutates `change_set['impacted']` in place. Never parses snippets back into
    structured updates (test plan: after is display-only)."""
    beat_after = {u["beatId"]: u for u in preview.get("beatUpdates", [])}
    scene_after = {u["sceneId"]: u for u in preview.get("sceneUpdates", [])}
    conflicts_by_object: dict[str, list[dict]] = {}
    for conflict in preview.get("continuityConflicts", []):
        conflicts_by_object.setdefault(conflict["objectId"], []).append(
            {"factId": conflict["factId"], "explanation": conflict["explanation"]}
        )
    for hit in change_set["impacted"]:
        oid = hit["objectId"]
        if hit["applyMode"] == ApplyMode.flag_only.value:
            hit["after"] = None
            continue
        if oid in beat_after:
            plan = beat_after[oid].get("beatPlan") or {}
            hit["after"] = (
                plan.get("whatHappens") or beat_after[oid].get("scriptText") or ""
            )
        elif oid in scene_after:
            fields = scene_after[oid].get("fields") or {}
            hit["after"] = fields.get("whatHappens") or fields.get("location") or ""
        hit["continuityFlags"] = conflicts_by_object.get(oid, [])


def preview_change_set(
    session,
    change_set_id: str,
    *,
    approved_object_ids: list[str],
    llm: LlmClient,
) -> dict:
    """Run `regenerate_elements`, store typed preview, return updated ChangeSet.

    Does not mutate the project doc or create a snapshot."""
    row = _get_change_set_row(session, change_set_id)
    change_set = copy.deepcopy(row.doc)
    project = session.get(ProjectRow, row.project_id)
    if project is None:
        raise ChangeSetNotFound(change_set_id)
    doc = project.doc
    ledger = [
        r.to_wire_dict()
        for r in session.query(LedgerFactRow).filter_by(project_id=project.id).all()
    ]

    regenerate_ids = _resolve_approved_regenerate_targets(
        change_set, approved_object_ids, doc
    )
    allowed = set(regenerate_ids)

    # Mark approved flags on the ChangeSet for the Review UI.
    approved_set = set(approved_object_ids)
    for hit in change_set["impacted"]:
        hit["approved"] = hit["objectId"] in approved_set

    if not regenerate_ids:
        preview = {
            "beatUpdates": [],
            "sceneUpdates": [],
            "continuityConflicts": [],
            "basedOnSnapshotId": project.head_snapshot_id,
            "generatedAt": _utcnow_iso(),
        }
        ChangeSetPreview.model_validate(preview)
        change_set["preview"] = preview
        change_set["status"] = "previewing"
        row.doc = change_set
        row.status = "previewing"
        session.commit()
        return change_set

    characters = list(_iter_characters(doc))
    nonce = render.new_nonce()
    system, user = render.build_regenerate_prompt(
        doc,
        regenerate_ids=regenerate_ids,
        instruction=change_set["instruction"],
        locked_siblings=_locked_siblings_for_regenerate(doc, allowed),
        neighbor_scenes=_neighbor_scene_summaries(doc, allowed),
        continuity_facts=_active_facts(ledger),
        characters=characters,
        nonce=nonce,
    )
    regenerated = llm.regenerate_elements(
        system=system, user_message=user, prompt_version=render.PROMPT_VERSION
    )
    _validate_regenerated_ids(regenerated, allowed)

    preview = _preview_wire_from_regenerated(regenerated, project.head_snapshot_id)
    _annotate_after_from_preview(change_set, preview)
    change_set["preview"] = preview
    change_set["status"] = "previewing"

    ChangeSet.model_validate(change_set)
    row.doc = change_set
    row.status = "previewing"
    project.updated_at = datetime.now(UTC).replace(tzinfo=None)
    session.commit()

    _logger.info(
        "change_set_previewed change_set_id=%s approved_ids=%s "
        "beat_updates=%d scene_updates=%d prompt_version=%s",
        change_set_id,
        regenerate_ids,
        len(preview["beatUpdates"]),
        len(preview["sceneUpdates"]),
        render.PROMPT_VERSION,
    )
    return change_set


def _apply_beat_update(doc: dict, update: dict) -> None:
    """Mutate `doc` in place with one typed beat update from the stored preview."""
    located = _locate_beat(doc, update["beatId"])
    if located is None:
        return
    _episode, _scene, beat = located
    plan = update.get("beatPlan")
    if plan is not None:
        beat["whatHappens"] = plan["whatHappens"]
        beat["audienceLearns"] = plan["audienceLearns"]
        beat["audienceFeels"] = plan["audienceFeels"]
    if update.get("scriptText") is not None:
        beat["scriptText"] = update["scriptText"]


def _apply_scene_update(doc: dict, update: dict) -> None:
    scene = _find_scene(doc, update["sceneId"])
    if scene is None:
        return
    fields = update.get("fields") or {}
    for wire_key, _snake in _SCENE_FIELD_WIRE:
        value = fields.get(wire_key)
        if value is not None:
            scene[wire_key] = value


def _mark_facts_stale_for_regenerated_beats(
    ledger: list[dict], regenerated_beat_ids: set[str]
) -> list[dict]:
    """Flag facts whose source beat was regenerated as `stale` (test plan)."""
    out: list[dict] = []
    for fact in ledger:
        span = fact.get("sourceSpan") or {}
        if (
            span.get("beatId") in regenerated_beat_ids
            and fact.get("status") == "active"
        ):
            updated = dict(fact)
            updated["status"] = "stale"
            out.append(updated)
        else:
            out.append(fact)
    return out


def _fact_summary(fact: dict) -> dict:
    return {
        "id": fact.get("id"),
        "fact": fact.get("fact", ""),
        "factType": fact.get("factType"),
        "knownBy": fact.get("knownBy", []),
        "audienceKnows": fact.get("audienceKnows", True),
    }


def apply_change_set(
    session,
    change_set_id: str,
    *,
    approved_object_ids: list[str],
    llm: LlmClient,
) -> dict:
    """Apply the stored preview payload verbatim (no regenerate), then extract
    + scan. Returns `{project, changeSet, consistencyFlags}`.

    Raises `ApplyRejected` for locked / flag_only / null preview / stale
    preview (route → 409)."""
    row = _get_change_set_row(session, change_set_id)
    change_set = copy.deepcopy(row.doc)
    project = session.get(ProjectRow, row.project_id)
    if project is None:
        raise ChangeSetNotFound(change_set_id)

    preview = change_set.get("preview")
    if preview is None:
        raise ApplyRejected("VALIDATION", "ChangeSet has no preview; run preview first")
    if preview.get("basedOnSnapshotId") != project.head_snapshot_id:
        raise ApplyRejected(
            "PREVIEW_STALE",
            "preview.basedOnSnapshotId no longer matches the project head",
        )

    regenerate_ids = _resolve_approved_regenerate_targets(
        change_set, approved_object_ids, project.doc
    )
    approved_set = set(approved_object_ids)
    for hit in change_set["impacted"]:
        hit["approved"] = hit["objectId"] in approved_set

    # Filter the stored payload to approved ids only — never re-call regenerate.
    beat_updates = [
        u for u in preview.get("beatUpdates", []) if u["beatId"] in approved_set
    ]
    scene_updates = [
        u for u in preview.get("sceneUpdates", []) if u["sceneId"] in approved_set
    ]

    new_doc = copy.deepcopy(project.doc)
    for update in beat_updates:
        _apply_beat_update(new_doc, update)
    for update in scene_updates:
        _apply_scene_update(new_doc, update)
    locks.assert_no_locked_writes(project.doc, new_doc)

    existing_ledger = [
        r.to_wire_dict()
        for r in session.query(LedgerFactRow).filter_by(project_id=project.id).all()
    ]
    existing_flags = [
        r.to_wire_dict()
        for r in session.query(ConsistencyFlagRow)
        .filter_by(project_id=project.id)
        .all()
    ]
    characters = list(_iter_characters(new_doc))

    regenerated_beat_ids = {u["beatId"] for u in beat_updates}
    ledger_after_stale = _mark_facts_stale_for_regenerated_beats(
        existing_ledger, regenerated_beat_ids
    )

    # Re-extract over each applied beat (accept-style §5), then scan (§8c).
    appended: list[dict] = []
    for update in beat_updates:
        located = _locate_beat(new_doc, update["beatId"])
        if located is None:
            continue
        episode, scene, beat = located
        system, user = render.build_extract_prompt(
            new_doc,
            episode["id"],
            {"id": scene["id"], "beats": [beat]},
            ledger_after_stale + appended,
            characters,
            render.new_nonce(),
        )
        extraction = llm.extract_ledger_facts(
            system=system, user_message=user, prompt_version=render.PROMPT_VERSION
        )
        new_facts, proposals, _contradictions = ledger_policy.apply_extraction_policy(
            extraction,
            existing_ledger=ledger_after_stale + appended,
            accepted_beat=beat,
            episode_id=episode["id"],
            scene_id=scene["id"],
        )
        appended.extend(new_facts + proposals)

    new_ledger = ledger_after_stale + appended
    changed_ids = regenerated_beat_ids | {u["sceneId"] for u in scene_updates}

    all_character_ids = frozenset(c["id"] for c in characters)
    context_scene = next(iter(changed_ids), "")
    scan_facts = [
        _fact_summary(f)
        for f in ledger_filter.eligible_facts(
            new_ledger,
            RelevanceContext(
                scene_id=context_scene, characters_in_scene=all_character_ids
            ),
        )
    ]
    untouched = [
        {
            "id": s["id"],
            "location": s.get("location", ""),
            "whatHappens": s.get("whatHappens", ""),
        }
        for _e, s in locks._iter_scenes(new_doc)
        if s["id"] not in changed_ids
    ]
    change_summary = {
        "kind": "change_set_apply",
        "changeSetId": change_set_id,
        "objectIds": sorted(changed_ids),
    }
    system, user = render.build_scan_prompt(
        new_doc, change_summary, untouched, scan_facts, characters, render.new_nonce()
    )
    scan_result = llm.scan_consistency(
        system=system, user_message=user, prompt_version=render.PROMPT_VERSION
    )
    new_flags = scan.build_consistency_flags(
        scan_result, new_doc, changed_ids, existing_flags
    )

    instruction = f"Applied change set {change_set_id}"

    def mutator(state: snapshots.MutationState) -> snapshots.MutationState:
        flags = state.flags + [
            {**f, "sourceChange": state.snapshot_id} for f in new_flags
        ]
        return snapshots.MutationState(
            doc=new_doc,
            ledger=new_ledger,
            flags=flags,
            snapshot_id=state.snapshot_id,
        )

    snap = snapshots.mutate(session, project.id, instruction, mutator)

    change_set["status"] = "applied"
    ChangeSet.model_validate(change_set)
    row = session.get(ChangeSetRow, change_set_id)
    row.doc = change_set
    row.status = "applied"
    session.commit()

    response_flags = [f for f in snap.flags if f["sourceChange"] == snap.id]
    _logger.info(
        "change_set_applied change_set_id=%s snapshot=%s approved_ids=%s "
        "beat_updates=%d scene_updates=%d flags=%d prompt_version=%s",
        change_set_id,
        snap.id,
        regenerate_ids,
        len(beat_updates),
        len(scene_updates),
        len(response_flags),
        render.PROMPT_VERSION,
    )
    return {
        "project": snap.doc,
        "changeSet": change_set,
        "consistencyFlags": response_flags,
    }


def discard_change_set(session, change_set_id: str) -> dict:
    """Mark the ChangeSet discarded; does not mutate the project."""
    row = _get_change_set_row(session, change_set_id)
    change_set = copy.deepcopy(row.doc)
    change_set["status"] = "discarded"
    row.doc = change_set
    row.status = "discarded"
    session.commit()
    _logger.info("change_set_discarded change_set_id=%s", change_set_id)
    return change_set


def flag_change_set(session, change_set_id: str) -> dict:
    """Mark the ChangeSet flagged (record concerns, no project mutation)."""
    row = _get_change_set_row(session, change_set_id)
    change_set = copy.deepcopy(row.doc)
    change_set["status"] = "flagged"
    row.doc = change_set
    row.status = "flagged"
    session.commit()
    _logger.info("change_set_flagged change_set_id=%s", change_set_id)
    return change_set


def get_change_set(session, change_set_id: str) -> dict:
    """Return the persisted ChangeSet wire dict (data contract §4 GET)."""
    row = _get_change_set_row(session, change_set_id)
    return copy.deepcopy(row.doc)


def list_change_sets(
    session, project_id: str, *, status: str | None = None
) -> list[dict]:
    """Return ChangeSets for a project, optionally filtered by status."""
    q = session.query(ChangeSetRow).filter_by(project_id=project_id)
    if status is not None:
        q = q.filter_by(status=status)
    rows = q.order_by(ChangeSetRow.id).all()
    return [copy.deepcopy(row.doc) for row in rows]
