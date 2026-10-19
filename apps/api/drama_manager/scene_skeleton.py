"""Guided-setup scene-skeleton generation (new-project-flow design spec
§6/§9.4): the three-candidate convergent loop that seeds a project's first
episode. Read-only w.r.t. the project doc — nothing is written until a
candidate is selected (`drama_manager/change_sets.py`'s
`create_scene_skeleton_change_set`, then Change Set apply). Product logic
only: every freeform value still routes through `drama_manager/render.py`
(the §8b choke point).

No writer text is logged here (hard rule 5): only ids/counts/PROMPT_VERSION.
"""

from __future__ import annotations

import logging
import uuid

from drama_manager import locks, render
from llm.errors import SchemaInvalidLlmError
from llm.protocol import LlmClient
from schemas import InitialSceneSkeletonCandidate, InitialSceneSkeletonScene

_logger = logging.getLogger("drama_manager.scene_skeleton")

CANDIDATE_COUNT = 3

# Model-filler strings we refuse to persist as real plan content. Matched
# case-insensitively after trim; empty/whitespace also counts as thin.
_THIN_TOKENS = frozenset({"placeholder", "n/a", "tbd", "todo", "none"})


def is_thin_field(value: str | None) -> bool:
    """True when a freeform plan field is empty or an obvious model stub."""
    text = (value or "").strip()
    if not text:
        return True
    return text.casefold() in _THIN_TOKENS


def scene_proposal_is_usable(scene) -> bool:
    """A skeleton scene is usable only when it has a real location, a real
    what-happens pitch, and at least one motivation (so Write's Next Beat
    has an in-scene cast). Accepts a Pydantic scene or a wire dict."""
    if hasattr(scene, "model_dump"):
        data = scene.model_dump(by_alias=True)
    else:
        data = scene
    if is_thin_field(data.get("location")):
        return False
    if is_thin_field(data.get("whatHappens")):
        return False
    motivations = data.get("motivations") or []
    if not motivations:
        return False
    return True


def assert_scenes_usable(scenes: list) -> None:
    """Raise `SchemaInvalidLlmError` when any scene is thin/unusable, or the
    list is empty after the model returned. Triggers the one schema retry
    (CLAUDE.md rule 9) rather than shipping junk into Plan/Write."""
    if not scenes:
        _logger.info("generate_scene_skeleton_empty_scenes")
        raise SchemaInvalidLlmError("generate_scene_skeleton")
    if any(not scene_proposal_is_usable(s) for s in scenes):
        _logger.info(
            "generate_scene_skeleton_thin_scenes rejected_count=%d",
            sum(1 for s in scenes if not scene_proposal_is_usable(s)),
        )
        raise SchemaInvalidLlmError("generate_scene_skeleton")


def _iter_characters(doc: dict):
    yield from doc.get("seriesBible", {}).get("characters", [])


def _mint_candidate_id() -> str:
    """Server-assigned kebab id (clients never mint ids; CLAUDE.md conventions)."""
    return f"skel-{uuid.uuid4().hex}"


def _mint_proposal_id() -> str:
    """Server-assigned scene *selection handle* — deliberately not a final
    scene id (data contract §9.4): apply mints the real `scene-*`/`beat-*`
    ids only for the proposals the writer approves."""
    return f"proposal-{uuid.uuid4().hex}"


def _one_line(text: str, limit: int = 80) -> str:
    line = " ".join(text.split())
    return line if len(line) <= limit else line[: limit - 1] + "…"


def _validate_character_ids(
    doc: dict, scenes: list[InitialSceneSkeletonScene]
) -> None:
    """Reject a candidate whose motivations reference a `characterId` that
    doesn't exist in the project — the model never invents ids (§6: "no
    server-owned scene/beat IDs"; motivations must reference *existing*
    characters). Logs rejected ids only (hard rule 5)."""
    known = {c["id"] for c in _iter_characters(doc)}
    invalid: list[str] = []
    for scene in scenes:
        for motivation in scene.motivations:
            if motivation.character_id not in known:
                invalid.append(motivation.character_id)
    if invalid:
        _logger.info(
            "generate_scene_skeleton_invalid_character_ids rejected_ids=%s",
            sorted(set(invalid)),
        )
        raise SchemaInvalidLlmError("generate_scene_skeleton")


def _to_scene_addition(scene: InitialSceneSkeletonScene) -> dict:
    """One model-proposed scene -> a server-annotated `SceneAddition` wire
    dict: mint `proposalId`, stamp `storyline: "A"` (MVP defers storyline
    inference — design spec §9.4). The model itself never sets either."""
    dumped = scene.model_dump(by_alias=True, mode="json")
    return {**dumped, "proposalId": _mint_proposal_id(), "storyline": "A"}


def generate_candidates(
    doc: dict,
    llm: LlmClient,
    *,
    count: int = CANDIDATE_COUNT,
) -> list[dict]:
    """Run the §9.4 convergent loop: `count` sequential `generate_scene_skeleton`
    calls, each carrying the AVOID list of prior candidates' labels/one-line
    summaries this round (mirrors §1's beat-candidate diversity mechanic,
    drama_manager/candidates.py). Returns validated
    `InitialSceneSkeletonCandidate` wire dicts, each bound to the project's
    current `headSnapshotId`. Raises `SchemaInvalidLlmError` if a candidate's
    motivations reference an unknown `characterId`."""
    based_on_snapshot_id = doc["headSnapshotId"]
    characters = [
        {
            "id": c.get("id", ""),
            "name": c.get("name", ""),
            "presentation": c.get("presentation", ""),
            "hiding": c.get("hiding", ""),
            "traits": c.get("traits", ""),
        }
        for c in _iter_characters(doc)
    ]
    bible = doc.get("seriesBible", {})
    series = {
        "premise": doc.get("premise", ""),
        "format": doc.get("format", {}),
        "theme": bible.get("existentialQuestion", {}).get("text", ""),
    }
    stories_to_avoid = list(bible.get("storiesToAvoid", []))
    existing_scenes = [
        {
            "id": scene["id"],
            "location": scene.get("location", ""),
            "whatHappens": scene.get("whatHappens", ""),
        }
        for episode in locks._iter_episodes(doc)
        for scene in locks.scenes_in_story_order(episode)
    ]

    candidates: list[dict] = []
    avoid: list[dict] = []
    for _ in range(count):
        nonce = render.new_nonce()
        system, user = render.build_scene_skeleton_prompt(
            doc,
            series=series,
            characters=characters,
            stories_to_avoid=stories_to_avoid,
            existing_scenes=existing_scenes,
            avoid=avoid,
            nonce=nonce,
        )
        raw = llm.generate_scene_skeleton(
            system=system, user_message=user, prompt_version=render.PROMPT_VERSION
        )
        assert_scenes_usable(raw.scenes)
        _validate_character_ids(doc, raw.scenes)
        if is_thin_field(raw.label):
            _logger.info("generate_scene_skeleton_thin_label")
            raise SchemaInvalidLlmError("generate_scene_skeleton")
        scene_additions = [_to_scene_addition(s) for s in raw.scenes]
        candidate = {
            "candidateId": _mint_candidate_id(),
            "basedOnSnapshotId": based_on_snapshot_id,
            "label": raw.label,
            "scenes": scene_additions,
        }
        InitialSceneSkeletonCandidate.model_validate(candidate)
        candidates.append(candidate)
        avoid.append(
            {
                "label": raw.label,
                "summary": _one_line(
                    "; ".join(s["whatHappens"] for s in scene_additions)
                ),
            }
        )

    _logger.info(
        "scene_skeleton_candidates_generated count=%d prompt_version=%s",
        len(candidates),
        render.PROMPT_VERSION,
    )
    return candidates
