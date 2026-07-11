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

from drama_manager import ledger_filter, ledger_policy, locks, render, scan, scene_skeleton
from drama_manager.ledger_filter import RelevanceContext
from llm.errors import SchemaInvalidLlmError
from llm.protocol import LlmClient
from schemas import (
    ApplyMode,
    ChangeSet,
    ChangeSetKind,
    ChangeSetPreview,
    ConfidenceLevel,
    ImpactedObjectType,
    InitialSceneSkeletonCandidate,
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


def _object_exists_as_type(
    doc: dict, ledger_by_id: dict[str, dict], object_type: str, object_id: str
) -> bool:
    """True when `object_id` exists in the project and matches `object_type`."""
    if object_type == ImpactedObjectType.scene.value:
        return _find_scene(doc, object_id) is not None
    if object_type == ImpactedObjectType.beat.value:
        return _find_beat(doc, object_id) is not None
    if object_type == ImpactedObjectType.character.value:
        return _find_character(doc, object_id) is not None
    if object_type == ImpactedObjectType.ledger_fact.value:
        return object_id in ledger_by_id
    return False


def _annotate_impacted(doc: dict, ledger: list[dict], blast) -> list[dict]:
    """Turn a `BlastRadius` into server-annotated `ImpactedObject` wire dicts.

    Rejects classifier rows whose `objectId` is missing or whose declared
    `objectType` does not match the live project (→ `SchemaInvalidLlmError`).
    Logging is ids only (hard rule 5)."""
    ledger_by_id = {f["id"]: f for f in ledger}
    out: list[dict] = []
    invalid_ids: list[str] = []
    for hit in blast.impacted:
        object_type = hit.object_type.value
        object_id = hit.object_id
        if not _object_exists_as_type(doc, ledger_by_id, object_type, object_id):
            invalid_ids.append(object_id)
            continue
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
    if invalid_ids:
        _logger.info(
            "classify_blast_radius_invalid_ids rejected_ids=%s",
            sorted(set(invalid_ids)),
        )
        raise SchemaInvalidLlmError("classify_blast_radius")
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


# ── §9.4 guided-setup scene skeleton (Task 6) ─────────────────────────────────
#
# Selecting a generated candidate (drama_manager/scene_skeleton.py) creates a
# ChangeSet that is already `previewing` — the candidate IS the preview, no
# further model call — with `impacted[].objectId` set to each scene's
# `proposalId` and `applyMode: "add"`. Apply (below) mints final scene/beat
# ids for the approved proposals and inserts them into the project's single
# episode (scaffolding it if the project has none yet), routed through the
# same lock guard every other apply path uses (CLAUDE.md rule 2).


def _episode_or_none(doc: dict) -> dict | None:
    seasons = doc.get("seasons") or []
    if seasons and seasons[0].get("episodes"):
        return seasons[0]["episodes"][0]
    return None


def _episode_id_or_placeholder(doc: dict) -> str:
    """The episode a skeleton Change Set targets — the existing episode id,
    or the deterministic id `_scaffold_or_get_episode` will mint if the
    project has none yet (fresh idea-path projects start with zero seasons —
    `storage/project_scaffold.py`)."""
    episode = _episode_or_none(doc)
    return episode["id"] if episode is not None else "ep-1"


def _episode_is_locked(doc: dict) -> bool:
    episode = _episode_or_none(doc)
    return bool(episode is not None and episode.get("locked"))


def _scene_addition_after(scene: dict) -> str:
    """Human-readable AFTER chip for an add-row: prefer what happens, then
    social situation / location. Never surface a bare model 'placeholder'."""
    for key in ("whatHappens", "socialSituation", "location"):
        value = (scene.get(key) or "").strip()
        if value and value.casefold() != "placeholder":
            return value
    return "New scene"


def _scene_addition_reason(scene: dict) -> str:
    location = (scene.get("location") or "").strip()
    if location and location.casefold() != "placeholder":
        return f"New scene · {location}"
    return "New scene from guided setup"


def create_scene_skeleton_change_set(
    session,
    project: ProjectRow,
    *,
    candidate: dict,
) -> dict:
    """Select a generated §9.4 skeleton candidate: revalidate it against the
    live project (schema, stale head, unknown character ids), then persist a
    ChangeSet already `previewing` (the candidate IS the preview). Never
    writes the project doc directly (CLAUDE.md rule 3 — "never write the
    plan directly from generation").

    Raises `ApplyRejected` for a stale `basedOnSnapshotId` or an unknown
    `characterId` in a motivation (route -> 409)."""
    validated = InitialSceneSkeletonCandidate.model_validate(candidate)
    if scene_skeleton.is_thin_field(validated.label):
        raise ApplyRejected(
            "VALIDATION",
            "candidate label is empty or a placeholder stub",
        )
    if any(
        not scene_skeleton.scene_proposal_is_usable(scene)
        for scene in validated.scenes
    ):
        raise ApplyRejected(
            "VALIDATION",
            "candidate contains an empty or placeholder scene "
            "(need real location, whatHappens, and at least one motivation)",
        )
    if validated.based_on_snapshot_id != project.head_snapshot_id:
        raise ApplyRejected(
            "PREVIEW_STALE",
            "candidate.basedOnSnapshotId no longer matches the project head",
        )

    doc = project.doc
    character_ids = {c["id"] for c in _iter_characters(doc)}
    for scene in validated.scenes:
        for motivation in scene.motivations:
            if motivation.character_id not in character_ids:
                raise ApplyRejected(
                    "VALIDATION",
                    f"motivation characterId {motivation.character_id!r} is "
                    "not a project character",
                )

    scene_dicts = [s.model_dump(by_alias=True, mode="json") for s in validated.scenes]
    episode_locked = _episode_is_locked(doc)
    impacted = [
        {
            "objectType": ImpactedObjectType.scene.value,
            "objectId": scene["proposalId"],
            "applyMode": ApplyMode.add.value,
            "reason": _scene_addition_reason(scene),
            "confidence": ConfidenceLevel.high.value,
            "locked": episode_locked,
            "before": "",
            "after": _scene_addition_after(scene),
            "continuityFlags": [],
            "approved": False,
        }
        for scene in scene_dicts
    ]
    preview = {
        "beatUpdates": [],
        "sceneUpdates": [],
        "continuityConflicts": [],
        "basedOnSnapshotId": validated.based_on_snapshot_id,
        "generatedAt": _utcnow_iso(),
        "sceneAdditions": scene_dicts,
    }
    ChangeSetPreview.model_validate(preview)

    change_set_id = _mint_change_set_id()
    change_set = {
        "id": change_set_id,
        "projectId": project.id,
        "kind": ChangeSetKind.initial_scene_skeleton.value,
        "instruction": validated.label,
        "targetObjectId": _episode_id_or_placeholder(doc),
        "impacted": impacted,
        "preview": preview,
        "status": "previewing",
        "createdAt": _utcnow_iso(),
    }
    ChangeSet.model_validate(change_set)

    session.add(
        ChangeSetRow(
            id=change_set_id,
            project_id=project.id,
            doc=change_set,
            status="previewing",
        )
    )
    project.updated_at = datetime.now(UTC).replace(tzinfo=None)
    session.commit()

    _logger.info(
        "scene_skeleton_change_set_created project_id=%s change_set_id=%s "
        "candidate_id=%s scene_count=%d prompt_version=%s",
        project.id,
        change_set_id,
        validated.candidate_id,
        len(scene_dicts),
        render.PROMPT_VERSION,
    )
    return change_set


def _mint_scene_id() -> str:
    return f"scene-{uuid.uuid4().hex}"


def _mint_beat_id() -> str:
    return f"beat-{uuid.uuid4().hex}"


def _scaffold_or_get_episode(doc: dict) -> dict:
    """Return `doc`'s single episode (mutating `doc` in place), scaffolding
    `season-1`/`ep-1` if the project has none yet — mirrors
    `fountain/pipeline.py`'s `_install_scenes` scaffold shape (MVP: exactly
    one season, one episode)."""
    seasons = doc.setdefault("seasons", [])
    if seasons and seasons[0].get("episodes"):
        return seasons[0]["episodes"][0]
    episode = {
        "id": "ep-1",
        "index": 0,
        "locked": False,
        "title": doc.get("title", ""),
        "premise": "",
        "seasonFunction": "",
        "storylines": [],
        "scenes": [],
    }
    if seasons:
        seasons[0]["episodes"] = [episode]
    else:
        doc["seasons"] = [
            {
                "id": "season-1",
                "index": 0,
                "locked": False,
                "seasonArc": "",
                "characterArcs": [],
                "episodes": [episode],
            }
        ]
    return episode


def _build_final_scene(addition: dict, index: int) -> dict:
    """One approved `SceneAddition` -> a final `Scene` wire dict: mint the
    scene id and one beat id per seed (index-ordered), `scriptText: ""` and
    both lock flags `False` (hard rule: "no scriptText in skeleton" — script
    text is written later, through Write mode's Accept, like any other
    planned beat)."""
    beats = [
        {
            "id": _mint_beat_id(),
            "index": bi,
            "locked": False,
            "whatHappens": seed["whatHappens"],
            "audienceLearns": seed["audienceLearns"],
            "audienceFeels": seed["audienceFeels"],
            "scriptText": "",
            "scriptLocked": False,
        }
        for bi, seed in enumerate(addition.get("beatPlanSeeds", []))
    ]
    return {
        "id": _mint_scene_id(),
        "index": index,
        "act": addition.get("act", 0),
        "storyline": "A",
        "locked": False,
        "location": addition.get("location", ""),
        "time": addition.get("time", ""),
        "socialSituation": addition.get("socialSituation", ""),
        "whatHappens": addition.get("whatHappens", ""),
        "audienceLearns": addition.get("audienceLearns", ""),
        "audienceFeels": addition.get("audienceFeels", ""),
        "motivations": addition.get("motivations", []),
        "beats": beats,
    }


def _resolve_approved_scene_additions(
    change_set: dict, approved_object_ids: list[str], doc: dict
) -> list[dict]:
    """Validate approved proposalIds against the stored preview's
    `sceneAdditions` (rule 6: the stored preview is the only apply input —
    never rendered snippets). Raises `ApplyRejected`: `LOCKED_OBJECT` when
    the target episode is locked (CLAUDE.md rule 2 — checked before any
    mutation), `VALIDATION` for an id that isn't a proposalId in this
    ChangeSet. Returns the approved additions in the candidate's original
    order, regardless of the request's order."""
    preview = change_set.get("preview") or {}
    scene_additions = preview.get("sceneAdditions")
    if scene_additions is None:
        raise ApplyRejected(
            "VALIDATION", "ChangeSet has no scene-addition preview"
        )
    by_id = {s["proposalId"]: s for s in scene_additions}
    impacted_by_id = _impacted_by_id(change_set)
    episode_locked = _episode_is_locked(doc)

    approved: list[dict] = []
    for object_id in approved_object_ids:
        scene = by_id.get(object_id)
        if scene is None:
            raise ApplyRejected(
                "VALIDATION",
                f"objectId {object_id!r} is not a proposalId in this ChangeSet",
            )
        hit = impacted_by_id.get(object_id)
        if (hit is not None and hit.get("locked")) or episode_locked:
            raise ApplyRejected(
                "LOCKED_OBJECT",
                f"objectId {object_id!r} targets a locked episode",
            )
        if not scene_skeleton.scene_proposal_is_usable(scene):
            raise ApplyRejected(
                "VALIDATION",
                f"objectId {object_id!r} is an empty or placeholder scene",
            )
        approved.append(scene)

    order = {s["proposalId"]: i for i, s in enumerate(scene_additions)}
    approved.sort(key=lambda s: order[s["proposalId"]])
    return approved


def _apply_scene_skeleton(
    session,
    row: ChangeSetRow,
    change_set: dict,
    project: ProjectRow,
    *,
    approved_object_ids: list[str],
    expected_head_snapshot_id: str | None,
) -> dict:
    """Apply an `initial_scene_skeleton` ChangeSet: mint final scene/beat ids
    for the approved proposals and insert them into the project's single
    episode (scaffolding it if absent), routed through the same lock guard
    every other apply path uses. No `regenerate_elements`/extraction/scan
    calls — there is no existing content to regenerate and no script text
    yet to extract facts from (that happens later, through Write mode's
    Accept, like any other planned beat)."""
    preview = change_set.get("preview")
    if preview is None:
        raise ApplyRejected(
            "VALIDATION", "ChangeSet has no preview; nothing to apply"
        )
    if preview.get("basedOnSnapshotId") != project.head_snapshot_id:
        raise ApplyRejected(
            "PREVIEW_STALE",
            "preview.basedOnSnapshotId no longer matches the project head",
        )

    approved_additions = _resolve_approved_scene_additions(
        change_set, approved_object_ids, project.doc
    )

    approved_set = set(approved_object_ids)
    for hit in change_set["impacted"]:
        hit["approved"] = hit["objectId"] in approved_set

    new_doc = copy.deepcopy(project.doc)
    episode = _scaffold_or_get_episode(new_doc)
    start_index = len(episode["scenes"])
    for offset, addition in enumerate(approved_additions):
        episode["scenes"].append(_build_final_scene(addition, start_index + offset))

    # Rule 2, belt-and-suspenders: a locked episode is structurally frozen —
    # this can only fire if `_resolve_approved_scene_additions`'s explicit
    # check above missed a race (e.g. the lock toggled between the two
    # reads); it can never silently let a locked-episode addition through.
    locks.assert_no_locked_writes(project.doc, new_doc)

    instruction = f"Applied scene skeleton {row.id}"

    def mutator(state: snapshots.MutationState) -> snapshots.MutationState:
        return snapshots.MutationState(
            doc=new_doc,
            ledger=state.ledger,
            flags=state.flags,
            snapshot_id=state.snapshot_id,
        )

    cas_expected = expected_head_snapshot_id or preview.get("basedOnSnapshotId")
    snap = snapshots.mutate(
        session,
        project.id,
        instruction,
        mutator,
        expected_head_snapshot_id=cas_expected,
    )

    change_set["status"] = "applied"
    ChangeSet.model_validate(change_set)
    row.doc = change_set
    row.status = "applied"
    session.commit()

    _logger.info(
        "scene_skeleton_change_set_applied change_set_id=%s snapshot=%s "
        "approved_count=%d prompt_version=%s",
        row.id,
        snap.id,
        len(approved_additions),
        render.PROMPT_VERSION,
    )
    return {"project": snap.doc, "changeSet": change_set, "consistencyFlags": []}


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
    craft_level: str | None = None,
) -> dict:
    """Run `regenerate_elements`, store typed preview, return updated ChangeSet.

    Does not mutate the project doc or create a snapshot. `craft_level=
    considered` runs a second polish regenerate (adoption A3)."""
    row = _get_change_set_row(session, change_set_id)
    change_set = copy.deepcopy(row.doc)
    if change_set.get("kind") == ChangeSetKind.initial_scene_skeleton.value:
        # §9.4: the candidate the writer selected already *is* the preview
        # (create_scene_skeleton_change_set) — there is no further model
        # call to re-run.
        raise ApplyRejected(
            "VALIDATION",
            "initial_scene_skeleton ChangeSets are already previewed at creation",
        )
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

    if (craft_level or "standard") == "considered":
        polish_nonce = render.new_nonce()
        polish_system, polish_user = render.build_regenerate_prompt(
            doc,
            regenerate_ids=regenerate_ids,
            instruction=(
                change_set["instruction"]
                + "\n\nCRITIQUE AND SELECT: Polish the regenerated elements — "
                "keep the strongest beats, tighten weak lines, do not expand scope."
            ),
            locked_siblings=_locked_siblings_for_regenerate(doc, allowed),
            neighbor_scenes=_neighbor_scene_summaries(doc, allowed),
            continuity_facts=_active_facts(ledger),
            characters=characters,
            nonce=polish_nonce,
        )
        regenerated = llm.regenerate_elements(
            system=polish_system,
            user_message=polish_user,
            prompt_version=render.PROMPT_VERSION,
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
    """Mutate `doc` in place with one typed beat update from the stored preview.

    Raises `ApplyRejected(VALIDATION)` if the beat is missing — never a silent
    no-op that still looks "applied"."""
    located = _locate_beat(doc, update["beatId"])
    if located is None:
        raise ApplyRejected(
            "VALIDATION",
            f"preview beatId {update['beatId']!r} is not in the project",
        )
    _episode, _scene, beat = located
    plan = update.get("beatPlan")
    if plan is not None:
        beat["whatHappens"] = plan["whatHappens"]
        beat["audienceLearns"] = plan["audienceLearns"]
        beat["audienceFeels"] = plan["audienceFeels"]
    if update.get("scriptText") is not None:
        beat["scriptText"] = update["scriptText"]


def _previewed_regenerate_ids(preview: dict) -> set[str]:
    """Object ids that the stored preview actually generated updates for."""
    ids = {u["beatId"] for u in preview.get("beatUpdates", [])}
    ids.update(u["sceneId"] for u in preview.get("sceneUpdates", []))
    return ids


def _apply_scene_update(doc: dict, update: dict) -> None:
    """Mutate `doc` in place with one typed scene update from the stored preview.

    Raises `ApplyRejected(VALIDATION)` if the scene is missing."""
    scene = _find_scene(doc, update["sceneId"])
    if scene is None:
        raise ApplyRejected(
            "VALIDATION",
            f"preview sceneId {update['sceneId']!r} is not in the project",
        )
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
    expected_head_snapshot_id: str | None = None,
) -> dict:
    """Apply the stored preview payload verbatim (no regenerate), then extract
    + scan. Returns `{project, changeSet, consistencyFlags}`.

    Raises `ApplyRejected` for locked / flag_only / null preview / stale
    preview / apply ids not in the stored preview (route → 409)."""
    row = _get_change_set_row(session, change_set_id)
    change_set = copy.deepcopy(row.doc)
    project = session.get(ProjectRow, row.project_id)
    if project is None:
        raise ChangeSetNotFound(change_set_id)

    if change_set.get("kind") == ChangeSetKind.initial_scene_skeleton.value:
        return _apply_scene_skeleton(
            session,
            row,
            change_set,
            project,
            approved_object_ids=approved_object_ids,
            expected_head_snapshot_id=expected_head_snapshot_id,
        )

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
    # Apply ids must be a subset of what preview actually generated — never
    # mark an id "approved/applied" when the stored payload has no update for it.
    previewed_ids = _previewed_regenerate_ids(preview)
    not_previewed = sorted(set(regenerate_ids) - previewed_ids)
    if not_previewed:
        raise ApplyRejected(
            "VALIDATION",
            "approvedObjectIds includes ids that were not previewed: "
            + ", ".join(not_previewed),
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

    # Prefer the client's If-Match when present; otherwise the preview's
    # basedOnSnapshotId (already checked above) is the CAS predicate so apply
    # cannot race another writer that moved the head after PREVIEW_STALE check.
    cas_expected = expected_head_snapshot_id or preview.get("basedOnSnapshotId")
    snap = snapshots.mutate(
        session,
        project.id,
        instruction,
        mutator,
        expected_head_snapshot_id=cas_expected,
    )

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
    """Return ChangeSets for a project, optionally filtered by status.

    `status` may be a single value or a comma-separated list
    (`draft,previewing`) for the Review open picker.
    """
    q = session.query(ChangeSetRow).filter_by(project_id=project_id)
    if status is not None:
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        if len(statuses) == 1:
            q = q.filter_by(status=statuses[0])
        elif statuses:
            q = q.filter(ChangeSetRow.status.in_(statuses))
    rows = q.order_by(ChangeSetRow.id).all()
    return [copy.deepcopy(row.doc) for row in rows]
