"""Ground and persist the import-time `NarrativeMap`.

The model may interpret a script, but it may not invent the anchors that make
that interpretation auditable. Every stored theme, act turn, character turn,
scene turn, Hero's Journey stage, and thread movement must name a real beat.
The server derives each persisted excerpt from that beat's authoritative text.
The merge also requires one scene turn for every imported scene and one act
row for every populated act.
"""

from __future__ import annotations

import hashlib
import logging
import re
from typing import TYPE_CHECKING

from fountain.characters import resolve_character_id

if TYPE_CHECKING:
    from schemas import InferredNarrativeMap, InferredNarrativeMapSynthesis

_logger = logging.getLogger("drama_manager.narrative_map")

_PLACEHOLDER_ANALYSIS_VALUES = frozenset(
    {
        "",
        "-",
        "n/a",
        "na",
        "unknown",
        "<unknown>",
        "placeholder",
        "[placeholder]",
        "tbd",
        "todo",
        "not enough information",
        "insufficient source content",
    }
)


def is_usable_analysis_text(value: object) -> bool:
    """Return whether a required analysis field is publishable prose.

    JSON-schema conformance alone permits placeholder strings. This deliberately
    narrow content gate keeps the server from storing an apparently successful
    map that tells a writer it could not analyze their already-supplied script.
    """
    text = str(value or "").strip()
    normalized = " ".join(text.casefold().split())
    if normalized in _PLACEHOLDER_ANALYSIS_VALUES or len(normalized) < 8:
        return False
    return not any(
        marker in normalized
        for marker in (
            "<unknown>",
            "placeholder",
            "insufficient source",
            "no populated whathappens",
            "no textual evidence",
            "would be inventing content",
        )
    )


class NarrativeMapValidationError(ValueError):
    """Schema-valid analysis failed the server's source-grounding checks."""

    def __init__(self, diagnostics: list[dict]) -> None:
        self.diagnostics = diagnostics
        super().__init__("invalid narrative map")


def _require_publishable_text(
    diagnostics: list[dict], path: str, value: object, *, allow_empty: bool = False
) -> None:
    """Reject a field that claims something unusable.

    `allow_empty` marks the interpretive prose that the verification repair is
    permitted to clear (`acts[].escalation`, a scene turn's dramatic function /
    conflict / stakes). Empty there means *no claim was made*, which is honest;
    this gate exists to stop a placeholder like "could not analyze" shipping as
    if it were analysis. Structural fields never pass empty.
    """
    if allow_empty and not str(value or "").strip():
        return
    if not is_usable_analysis_text(value):
        diagnostics.append({"code": "unusable_analysis_text", "path": path})


def _validate_analysis_quality(result: InferredNarrativeMap, diagnostics: list[dict]) -> None:
    """Add content-quality diagnostics before we attach a map to a snapshot."""
    _require_publishable_text(diagnostics, "dramaticQuestion", result.dramatic_question)
    _require_publishable_text(diagnostics, "centralConflict", result.central_conflict)
    _require_publishable_text(diagnostics, "controllingIdea", result.controlling_idea)
    _require_publishable_text(diagnostics, "heroJourney.rationale", result.hero_journey.rationale)
    for index, theme in enumerate(result.themes):
        _require_publishable_text(diagnostics, f"themes[{index}].label", theme.label)
        _require_publishable_text(diagnostics, f"themes[{index}].statement", theme.statement)
    for index, act in enumerate(result.acts):
        _require_publishable_text(
            diagnostics, f"acts[{index}].dramaticQuestion", act.dramatic_question
        )
        _require_publishable_text(
            diagnostics, f"acts[{index}].escalation", act.escalation, allow_empty=True
        )
    for index, arc in enumerate(result.character_arcs):
        # Clearable readings of the arc — the verification repair may empty any
        # of these when the verifier rejects the claim, leaving the arc itself
        # (its character, and its remaining turning points) intact.
        for field, value in (
            ("want", arc.want),
            ("need", arc.need),
            ("internalConflict", arc.internal_conflict),
            ("externalPressure", arc.external_pressure),
            ("arcSummary", arc.arc_summary),
        ):
            _require_publishable_text(
                diagnostics, f"characterArcs[{index}].{field}", value, allow_empty=True
            )
        for turn_index, turn in enumerate(arc.turning_points):
            _require_publishable_text(
                diagnostics,
                f"characterArcs[{index}].turningPoints[{turn_index}].change",
                turn.change,
            )
    for index, turn in enumerate(result.scene_turns):
        for field, value, clearable in (
            ("dramaticFunction", turn.dramatic_function, True),
            ("conflict", turn.conflict, True),
            ("stakes", turn.stakes, True),
            ("turn", turn.turn, False),
        ):
            _require_publishable_text(
                diagnostics, f"sceneTurns[{index}].{field}", value, allow_empty=clearable
            )
    for index, movement in enumerate(result.thread_movements):
        _require_publishable_text(
            diagnostics, f"threadMovements[{index}].summary", movement.summary
        )


def _find_episode(doc: dict, episode_id: str) -> dict:
    for season in doc.get("seasons") or []:
        for episode in season.get("episodes") or []:
            if episode.get("id") == episode_id:
                return episode
    raise KeyError(episode_id)


def _source_quote(beat: dict) -> str:
    """Return a short exact excerpt from a cited beat for persisted evidence."""
    script_text = str(beat.get("scriptText") or "")
    excerpts = [line.strip() for line in script_text.splitlines() if line.strip()]
    for excerpt in excerpts:
        letters = "".join(character for character in excerpt if character.isalpha())
        is_slugline = excerpt.upper().startswith(("INT.", "EXT.", "I/E.", "INT/EXT.", "EST."))
        is_cue = bool(letters) and letters == letters.upper() and len(excerpt) <= 48
        if not is_slugline and not is_cue:
            return excerpt[:200]
    return excerpts[0][:200] if excerpts else ""


def materialize_synthesized_threads(
    doc: dict,
    episode_id: str,
    result: InferredNarrativeMapSynthesis,
) -> int:
    """Create grounded episode threads when import produced none.

    Synthesis may discover coherent threads even when the earlier import pass
    left ``episode.threads`` empty. Model-provided thread ids are treated only
    as grouping keys: the server mints persisted ids, derives setup/payoff
    scenes and quotes from cited beats, and remaps every movement before normal
    validation. Existing imported threads are never supplemented this way;
    unknown references against an existing registry still fail closed.
    """

    episode = _find_episode(doc, episode_id)
    if episode.get("threads") or not result.thread_movements:
        return 0

    beat_context: dict[str, tuple[str, dict]] = {}
    for scene in episode.get("scenes") or []:
        scene_id = scene.get("id")
        if not scene_id:
            continue
        for beat in scene.get("beats") or []:
            beat_id = beat.get("id")
            if beat_id:
                beat_context[beat_id] = (scene_id, beat)

    grouped: dict[str, list] = {}
    for movement in result.thread_movements:
        grouped.setdefault(movement.thread_id, []).append(movement)

    characters = (doc.get("seriesBible") or {}).get("characters") or []
    remapped_ids: dict[str, str] = {}
    materialized: list[dict] = []
    for provisional_id, movements in grouped.items():
        grounded = [movement for movement in movements if movement.beat_id in beat_context]
        if not grounded:
            continue
        setup = next(
            (movement for movement in grounded if str(movement.phase) == "setup"),
            grounded[0],
        )
        payoff = next(
            (movement for movement in grounded if str(movement.phase) == "payoff"),
            None,
        )
        setup_scene_id, setup_beat = beat_context[setup.beat_id]
        payoff_scene_id = None
        payoff_quote = ""
        if payoff is not None:
            payoff_scene_id, payoff_beat = beat_context[payoff.beat_id]
            payoff_quote = _source_quote(payoff_beat)

        label_words = [
            word
            for word in re.split(r"[-_\s]+", re.sub(r"^thread[-_]", "", provisional_id))
            if word
        ]
        label = " ".join(word.capitalize() for word in label_words) or "Story thread"
        label_tokens = {word.casefold() for word in label_words}
        owner_ids: list[str] = []
        for character in characters:
            names = [character.get("name"), *(character.get("aliases") or [])]
            if any(
                set(re.findall(r"\w+", str(name).casefold())) & label_tokens
                for name in names
                if name
            ):
                owner_ids.append(character["id"])

        summary = setup.summary
        if payoff is not None and payoff.summary != setup.summary:
            summary = f"{setup.summary} {payoff.summary}"
        stable_key = f"{episode_id}:{provisional_id}".encode()
        thread_id = f"thread-{hashlib.sha256(stable_key).hexdigest()[:12]}"
        remapped_ids[provisional_id] = thread_id
        materialized.append(
            {
                "id": thread_id,
                "label": label,
                "summary": summary,
                "status": "paid_off" if payoff is not None else "open",
                "ownerCharacterIds": owner_ids,
                "setupSceneId": setup_scene_id,
                "payoffSceneId": payoff_scene_id,
                "setupQuote": _source_quote(setup_beat),
                "payoffQuote": payoff_quote,
                "locked": False,
            }
        )

    for movement in result.thread_movements:
        movement.thread_id = remapped_ids.get(movement.thread_id, movement.thread_id)
    episode["threads"] = materialized
    _logger.info(
        "materialize_synthesized_threads episode_id=%s threads=%d movements=%d",
        episode_id,
        len(materialized),
        len(result.thread_movements),
    )
    return len(materialized)


def _grounded_beat(
    beat_by_id: dict[str, dict], beat_id: str, diagnostics: list[dict], path: str
) -> dict | None:
    beat = beat_by_id.get(beat_id)
    if beat is None:
        diagnostics.append({"code": "unknown_beat", "path": path, "beatId": beat_id})
        return None
    if not _source_quote(beat):
        diagnostics.append({"code": "beat_has_no_source_text", "path": path, "beatId": beat_id})
        return None
    return beat


def scene_has_no_source(scene: dict) -> bool:
    """Whether a scene carries nothing a map could be grounded in.

    A scene with no beats, or whose beats all lack `scriptText`, is a stub the
    writer has not written yet — a normal Plan-mode state, and one the UI spec
    documents ("Empty scene (no beats)"). It is not a defect in the script and
    must not block mapping the rest of the episode: the module's own rule is to
    "reject only true source gaps ... not a reason to abandon the writer".

    Coverage expectations exclude these scenes for the same reason a claim
    about them could never be verified — there is no source to cite. They are
    still recorded rather than silently skipped (see
    `prepare_narrative_map_source`).
    """
    return not any(
        str(beat.get("scriptText") or "").strip() for beat in scene.get("beats") or []
    )


def merge_narrative_map(doc: dict, episode_id: str, result: InferredNarrativeMap) -> dict:
    """Attach a validated `narrativeMap` to an episode without touching locks.

    This function intentionally either replaces the complete inferred map or
    raises before mutating it. The import caller uses that failure to make one
    focused repair request and then preserves its all-or-nothing transaction.
    """
    episode = _find_episode(doc, episode_id)
    existing = episode.get("narrativeMap")
    if episode.get("locked") or (isinstance(existing, dict) and existing.get("locked")):
        _logger.info("merge_narrative_map skipped locked episode_id=%s", episode_id)
        return doc

    # Stub scenes are excluded from coverage: nothing in them can be cited, so
    # requiring a turn or an act beat for one would fail every draft that has
    # an unwritten scene in it.
    scenes = [
        scene
        for scene in episode.get("scenes") or []
        if not scene_has_no_source(scene)
    ]
    scene_by_id = {scene.get("id"): scene for scene in scenes if scene.get("id")}
    beat_by_id: dict[str, dict] = {}
    beat_scene_ids: dict[str, str] = {}
    for scene in scenes:
        scene_id = scene.get("id")
        for beat in scene.get("beats") or []:
            beat_id = beat.get("id")
            if beat_id and scene_id:
                beat_by_id[beat_id] = beat
                beat_scene_ids[beat_id] = scene_id

    diagnostics: list[dict] = []
    _validate_analysis_quality(result, diagnostics)
    expected_acts = {int(scene.get("act", 0)) for scene in scenes}
    seen_acts: set[int] = set()
    acts: list[dict] = []
    for index, item in enumerate(result.acts):
        path = f"acts[{index}]"
        if item.act in seen_acts:
            diagnostics.append({"code": "duplicate_act", "path": path, "act": item.act})
            continue
        seen_acts.add(item.act)
        if item.act not in expected_acts:
            diagnostics.append({"code": "unknown_act", "path": path, "act": item.act})
            continue
        beat = _grounded_beat(beat_by_id, item.turn_beat_id, diagnostics, path)
        if beat is None:
            continue
        turn_scene = scene_by_id[beat_scene_ids[item.turn_beat_id]]
        if int(turn_scene.get("act", 0)) != item.act:
            diagnostics.append(
                {"code": "act_turn_beat_mismatch", "path": path, "beatId": item.turn_beat_id}
            )
            continue
        acts.append(
            {
                "act": item.act,
                "dramaticQuestion": item.dramatic_question,
                "escalation": item.escalation,
                "turnBeatId": item.turn_beat_id,
                "evidenceQuote": _source_quote(beat),
            }
        )
    if seen_acts != expected_acts:
        diagnostics.append(
            {
                "code": "act_coverage_incomplete",
                "expectedActs": sorted(expected_acts),
                "receivedActs": sorted(seen_acts),
            }
        )

    themes: list[dict] = []
    for index, theme in enumerate(result.themes):
        evidence: list[dict] = []
        for evidence_index, item in enumerate(theme.evidence):
            path = f"themes[{index}].evidence[{evidence_index}]"
            beat = _grounded_beat(beat_by_id, item.beat_id, diagnostics, path)
            if beat is not None:
                evidence.append({"beatId": item.beat_id, "quote": _source_quote(beat)})
        if len(evidence) == len(theme.evidence):
            themes.append(
                {
                    "label": theme.label,
                    "statement": theme.statement,
                    "evidence": evidence,
                }
            )

    characters = (doc.get("seriesBible") or {}).get("characters") or []
    character_arcs: list[dict] = []
    seen_character_ids: set[str] = set()
    for index, arc in enumerate(result.character_arcs):
        path = f"characterArcs[{index}]"
        character_id = resolve_character_id(arc.character_name, characters)
        if character_id is None:
            diagnostics.append({"code": "unknown_character", "path": path})
            continue
        if character_id in seen_character_ids:
            diagnostics.append({"code": "duplicate_character_arc", "path": path})
            continue
        seen_character_ids.add(character_id)
        turns: list[dict] = []
        for turn_index, turn in enumerate(arc.turning_points):
            turn_path = f"{path}.turningPoints[{turn_index}]"
            beat = _grounded_beat(beat_by_id, turn.beat_id, diagnostics, turn_path)
            if beat is not None:
                turns.append(
                    {
                        "beatId": turn.beat_id,
                        "change": turn.change,
                        "quote": _source_quote(beat),
                    }
                )
        if len(turns) == len(arc.turning_points):
            character_arcs.append(
                {
                    "characterId": character_id,
                    "want": arc.want,
                    "need": arc.need,
                    "internalConflict": arc.internal_conflict,
                    "externalPressure": arc.external_pressure,
                    "arcSummary": arc.arc_summary,
                    "turningPoints": turns,
                }
            )

    scene_turns: list[dict] = []
    seen_scene_ids: set[str] = set()
    for index, turn in enumerate(result.scene_turns):
        path = f"sceneTurns[{index}]"
        if turn.scene_id not in scene_by_id:
            diagnostics.append({"code": "unknown_scene", "path": path, "sceneId": turn.scene_id})
            continue
        if turn.scene_id in seen_scene_ids:
            diagnostics.append(
                {"code": "duplicate_scene_turn", "path": path, "sceneId": turn.scene_id}
            )
            continue
        seen_scene_ids.add(turn.scene_id)
        beat = _grounded_beat(beat_by_id, turn.turn_beat_id, diagnostics, path)
        if beat is None:
            continue
        if beat_scene_ids[turn.turn_beat_id] != turn.scene_id:
            diagnostics.append(
                {"code": "scene_turn_beat_mismatch", "path": path, "beatId": turn.turn_beat_id}
            )
            continue
        focal_character_id = (
            resolve_character_id(turn.focal_character_name, characters)
            if turn.focal_character_name
            else None
        )
        if turn.focal_character_name and focal_character_id is None:
            diagnostics.append({"code": "unknown_character", "path": path})
            continue
        scene_turns.append(
            {
                "sceneId": turn.scene_id,
                "focalCharacterId": focal_character_id,
                "dramaticFunction": turn.dramatic_function,
                "conflict": turn.conflict,
                "stakes": turn.stakes,
                "turnBeatId": turn.turn_beat_id,
                "turn": turn.turn,
                "evidenceQuote": _source_quote(beat),
            }
        )
    expected_scene_ids = set(scene_by_id)
    if seen_scene_ids != expected_scene_ids:
        diagnostics.append(
            {
                "code": "scene_turn_coverage_incomplete",
                "expectedSceneCount": len(expected_scene_ids),
                "receivedSceneCount": len(seen_scene_ids),
            }
        )

    hero = result.hero_journey
    protagonist_character_id = None
    hero_stages: list[dict] = []
    if hero.applies:
        protagonist_character_id = resolve_character_id(hero.protagonist_name or "", characters)
        if protagonist_character_id is None:
            diagnostics.append({"code": "hero_protagonist_unresolved"})
        for index, stage in enumerate(hero.stages):
            path = f"heroJourney.stages[{index}]"
            beat = _grounded_beat(beat_by_id, stage.beat_id, diagnostics, path)
            if beat is not None:
                hero_stages.append(
                    {
                        "stage": stage.stage,
                        "beatId": stage.beat_id,
                        "summary": stage.summary,
                        "evidenceQuote": _source_quote(beat),
                    }
                )
        if not hero_stages:
            diagnostics.append({"code": "hero_journey_has_no_grounded_stages"})
    elif hero.stages or hero.protagonist_name:
        diagnostics.append({"code": "hero_journey_not_applicable_has_anchors"})

    known_thread_ids = {thread.get("id") for thread in episode.get("threads") or []}
    thread_movements: list[dict] = []
    for index, movement in enumerate(result.thread_movements):
        path = f"threadMovements[{index}]"
        if movement.thread_id not in known_thread_ids:
            diagnostics.append({"code": "unknown_thread", "path": path})
            continue
        beat = _grounded_beat(beat_by_id, movement.beat_id, diagnostics, path)
        if beat is not None:
            thread_movements.append(
                {
                    "threadId": movement.thread_id,
                    "beatId": movement.beat_id,
                    "phase": movement.phase,
                    "summary": movement.summary,
                    "evidenceQuote": _source_quote(beat),
                }
            )

    if diagnostics:
        raise NarrativeMapValidationError(diagnostics)

    episode["narrativeMap"] = {
        "dramaticQuestion": result.dramatic_question,
        "centralConflict": result.central_conflict,
        "controllingIdea": result.controlling_idea,
        "themes": themes,
        "acts": sorted(acts, key=lambda item: item["act"]),
        "heroJourney": {
            "applies": hero.applies,
            "protagonistCharacterId": protagonist_character_id,
            "rationale": hero.rationale,
            "stages": hero_stages,
        },
        "characterArcs": character_arcs,
        "sceneTurns": scene_turns,
        "threadMovements": thread_movements,
        "provenance": "inferred",
        "locked": False,
    }
    _logger.info(
        "merge_narrative_map acts=%d themes=%d arcs=%d scene_turns=%d thread_movements=%d",
        len(acts),
        len(themes),
        len(character_arcs),
        len(scene_turns),
        len(thread_movements),
    )
    return doc
