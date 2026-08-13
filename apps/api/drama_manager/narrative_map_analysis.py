"""Evidence-first preparation for resilient Narrative Map runs.

This module deliberately keeps raw screenplay access in the analysis layer.
The final map only stores small, auditable citations, but all meaningful scene
analysis is derived from the saved source rather than assuming import-time beat
summaries were complete. It performs no I/O and never logs writer-owned text.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass

from drama_manager.narrative_map import is_usable_analysis_text, scene_has_no_source
from schemas import (
    InferredNarrativeMap,
    InferredNarrativeMapSynthesis,
    InferredNarrativeSceneAnalysisBatch,
    NarrativeMapVerification,
)

# 3.2: synthesis reads a server-counted character footprint, so an arc needs a
# character who carries scenes rather than one who outranks them (0.47.0).
#
# 3.1: the verifier must settle a finding before filing it, rather than
# retracting it inside an unsupportedClaims reason (PROMPT_VERSION 0.46.0).
#
# 3.0: an act's escalation carries its own beat citations (PROMPT_VERSION
# 0.45.0). The synthesis response and the persisted map both change shape, so
# no earlier checkpoint's synthesis can be reused.
#
# 2.9: the verifier judges each claim at its own scope — act-level prose against
# any beat in the act, not against the single cited turn beat (PROMPT_VERSION
# 0.44.0). The audit packet gains each beat's act and each act's scene span.
#
# 2.8: the verifier's blocking and advisory lists are mutually exclusive, and
# the blocking one carries a reason so no explanation has to ride along in the
# path (PROMPT_VERSION 0.43.0). The checkpointed verification changes shape with
# it, so this is not just a prompt fix.
#
# 2.7: the scene pass may report a bare establishing slugline as orientation
# instead of manufacturing conflict for it (PROMPT_VERSION 0.42.0). Bumped
# because a same-version retry is blocked to prevent a repeat charge, and that
# block keys on this constant — a prompt fix that changes what the analysis
# produces has to be a new analysis version or the rejected run can never be
# retried at all.
NARRATIVE_MAP_ANALYSIS_VERSION = "3.2"
NARRATIVE_MAP_SCENE_CHUNK_CHAR_BUDGET = 24_000
NARRATIVE_MAP_SCENES_PER_CHUNK = 1
NARRATIVE_MAP_VERIFICATION_EXCERPT_CHARS = 520
NARRATIVE_MAP_VERIFICATION_QUOTES_PER_BEAT = 2


class NarrativeMapReadinessError(ValueError):
    """The saved project cannot support a trustworthy Narrative Map yet."""

    def __init__(self, diagnostics: list[dict]) -> None:
        self.diagnostics = diagnostics
        super().__init__("narrative map source is not ready")


class NarrativeMapAnalysisValidationError(ValueError):
    """A scene packet or verifier result failed evidence-quality checks."""

    def __init__(self, diagnostics: list[dict]) -> None:
        self.diagnostics = diagnostics
        super().__init__("narrative map analysis failed validation")


@dataclass(frozen=True)
class NarrativeMapSource:
    episode_id: str
    source_hash: str
    scene_sources: list[dict]
    known_cast: list[dict]
    threads: list[dict]
    story_overview: dict | None
    scene_count: int
    semantic_coverage: float
    stub_scene_ids: list[str]


def _episode(doc: dict) -> dict | None:
    return next(
        (
            episode
            for season in doc.get("seasons") or []
            for episode in season.get("episodes") or []
        ),
        None,
    )


def _canonical_source_payload(doc: dict, episode: dict, known_cast: list[dict]) -> dict:
    return {
        "format": doc.get("format") or {},
        "cast": known_cast,
        "scenes": [
            {
                "id": scene.get("id"),
                "act": scene.get("act", 0),
                "location": scene.get("location", ""),
                "beats": [
                    {
                        "id": beat.get("id"),
                        "scriptText": beat.get("scriptText", ""),
                    }
                    for beat in scene.get("beats") or []
                ],
            }
            for scene in episode.get("scenes") or []
        ],
    }


def _scene_source_kind(script_text: str, overview_summary: str) -> str:
    """Classify blocks that should not be forced into dramatic-scene fields."""
    normalized_summary = _normalized_text(overview_summary)
    normalized_lines = {_normalized_text(line) for line in script_text.splitlines()}
    normalized_source = _normalized_text(script_text)
    if (
        normalized_summary.startswith("title page:")
        or ("written by" in normalized_source and "final draft" in normalized_source)
        or "sets and cast list" in normalized_summary
        or ("cast" in normalized_lines and "fade in:" in normalized_lines)
    ):
        return "front_matter"
    if (
        normalized_summary.startswith("establishing ")
        or normalized_summary.startswith("dawn breaks ")
        or " establishing " in f" {normalized_source} "
        or " as we establish " in f" {normalized_source} "
    ):
        return "establishing"
    return "narrative"


def prepare_narrative_map_source(doc: dict) -> NarrativeMapSource:
    """Build a complete source packet and reject only true source gaps.

    Empty semantic beat fields are measured but are *not* a reason to abandon
    the writer: the analysis pipeline heals them from the preserved
    screenplay. Missing source text is the hard stop because no model can
    ground a claim the project does not contain.
    """
    episode = _episode(doc)
    if episode is None:
        raise NarrativeMapReadinessError([{"code": "missing_episode"}])
    existing_map = episode.get("narrativeMap")
    if episode.get("locked") or (isinstance(existing_map, dict) and existing_map.get("locked")):
        raise NarrativeMapReadinessError([{"code": "narrative_map_locked"}])

    story_overview = episode.get("storyOverview")
    overview_by_scene = {
        item.get("sceneId"): str(item.get("summary") or "")
        for item in (story_overview or {}).get("outline", [])
        if isinstance(item, dict) and item.get("sceneId")
    }
    scene_sources: list[dict] = []
    diagnostics: list[dict] = []
    semantic_fields = 0
    populated_semantic_fields = 0
    stub_scene_ids: list[str] = []
    for scene in episode.get("scenes") or []:
        scene_id = scene.get("id")
        beats = scene.get("beats") or []
        if not scene_id:
            diagnostics.append({"code": "scene_has_no_id"})
            continue
        # An unwritten scene is a normal draft state, not a source gap. Record
        # it and carry on rather than refusing to map the whole episode.
        if scene_has_no_source(scene):
            stub_scene_ids.append(scene_id)
            continue
        source_beats: list[dict] = []
        for beat in beats:
            beat_id = beat.get("id")
            script_text = str(beat.get("scriptText") or "")
            if not beat_id or not script_text.strip():
                # The scene has source elsewhere (a fully unwritten scene was
                # already taken out above), so this one beat is simply not
                # written yet — skip it, do not fail the run.
                continue
            for field in ("whatHappens", "audienceLearns", "audienceFeels"):
                semantic_fields += 1
                if str(beat.get(field) or "").strip():
                    populated_semantic_fields += 1
            source_beats.append(
                {
                    "beatId": beat_id,
                    "whatHappens": beat.get("whatHappens") or "",
                    "audienceLearns": beat.get("audienceLearns") or "",
                    "audienceFeels": beat.get("audienceFeels") or "",
                    "scriptText": script_text,
                }
            )
        if source_beats:
            overview_summary = overview_by_scene.get(scene_id, "")
            script_text = "\n".join(beat["scriptText"] for beat in source_beats)
            scene_sources.append(
                {
                    "sceneId": scene_id,
                    "act": int(scene.get("act", 0)),
                    "location": scene.get("location") or "",
                    "sourceKind": _scene_source_kind(script_text, overview_summary),
                    "overviewSummary": overview_summary,
                    "beats": source_beats,
                }
            )

    if diagnostics or not scene_sources:
        if not scene_sources:
            diagnostics.append({"code": "no_source_backed_scenes"})
        raise NarrativeMapReadinessError(diagnostics)

    characters = (doc.get("seriesBible") or {}).get("characters") or []
    known_cast = [
        {"id": character["id"], "name": character["name"], "aliases": character.get("aliases", [])}
        for character in characters
        if character.get("id") and character.get("name")
    ]
    canonical = _canonical_source_payload(doc, episode, known_cast)
    source_hash = hashlib.sha256(
        json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode(
            "utf-8"
        )
    ).hexdigest()
    return NarrativeMapSource(
        episode_id=episode["id"],
        source_hash=source_hash,
        scene_sources=scene_sources,
        known_cast=known_cast,
        threads=list(episode.get("threads") or []),
        story_overview=story_overview,
        scene_count=len(scene_sources),
        stub_scene_ids=stub_scene_ids,
        semantic_coverage=(populated_semantic_fields / semantic_fields if semantic_fields else 0.0),
    )


def chunk_scene_sources(
    scene_sources: list[dict], *, char_budget: int = NARRATIVE_MAP_SCENE_CHUNK_CHAR_BUDGET
) -> list[list[dict]]:
    """Return one intact scene per request.

    A single-scene request gives the response schema an unambiguous coverage
    target and lets the worker checkpoint or repair that scene without paying
    to repeat already accepted analysis.
    """
    chunks: list[list[dict]] = []
    current: list[dict] = []
    for scene in scene_sources:
        serialized = len(json.dumps(scene, ensure_ascii=False))
        current_size = sum(len(json.dumps(item, ensure_ascii=False)) for item in current)
        if current and (
            len(current) >= NARRATIVE_MAP_SCENES_PER_CHUNK
            or current_size + serialized > char_budget
        ):
            chunks.append(current)
            current = [scene]
        else:
            current.append(scene)
    if current:
        chunks.append(current)
    return chunks


def _normalized_text(value: str) -> str:
    return " ".join(value.casefold().split())


def _source_anchor(scene: dict) -> tuple[str, str] | None:
    for beat in scene["beats"]:
        for line in beat["scriptText"].splitlines():
            quote = line.strip()
            if len(_normalized_text(quote)) >= 8:
                return beat["beatId"], quote[:180]
    return None


def _source_anchor_for_hint(scene: dict, hint: str) -> tuple[str, str] | None:
    """Choose an exact source line that best overlaps a moment description."""
    hint_words = {word for word in re.findall(r"\w+", hint.casefold()) if len(word) >= 3}
    candidates: list[tuple[int, int, str, str]] = []
    for beat_index, beat in enumerate(scene["beats"]):
        for line_index, line in enumerate(beat["scriptText"].splitlines()):
            quote = line.strip()
            normalized = _normalized_text(quote)
            if len(normalized) < 8:
                continue
            upper = quote.upper()
            if upper.startswith(("INT.", "EXT.", "I/E.", "INT/EXT.", "EST.")):
                continue
            if upper in {"CONTINUED:", "(CONTINUED)", "CUT TO:", "FADE IN:", "FADE OUT:"}:
                continue
            if quote == upper and len(quote) <= 40:
                continue
            quote_words = set(re.findall(r"\w+", quote.casefold()))
            overlap = len(hint_words & quote_words)
            candidates.append((overlap, -(beat_index * 10_000 + line_index), beat["beatId"], quote))
    if not candidates:
        return _source_anchor(scene)
    _overlap, _position, beat_id, quote = max(candidates)
    return beat_id, quote[:180]


def _moment_beat(source_beats: list[dict], beat_id: str) -> dict | None:
    """Resolve a model beat hint without asking it to transcribe evidence.

    The server owns the source text and therefore owns the excerpt attached to
    a citation. A single-beat scene is unambiguous even when the model mistypes
    its id; multi-beat scenes still require a real supplied beat id.
    """
    by_id = {beat["beatId"]: beat for beat in source_beats}
    if beat_id in by_id:
        return by_id[beat_id]
    return source_beats[0] if len(source_beats) == 1 else None


def source_backed_scene_fallback(
    source_scene: dict,
    result: InferredNarrativeSceneAnalysisBatch,
    diagnostics: list[dict],
) -> dict | None:
    """Build a transparent low-resolution packet after one weak model read.

    The fallback never invents plot. It is available only when import already
    produced a publishable source-backed outline summary and the screenplay
    still supplies a real beat/excerpt. Valid model fields are retained; weak
    fields become explicit connective-scene language. The packet is marked so
    macro synthesis and durable diagnostics cannot mistake it for a full scene
    analysis.
    """
    overview = str(source_scene.get("overviewSummary") or "").strip()
    anchor = _source_anchor_for_hint(source_scene, overview)
    if not is_usable_analysis_text(overview) or anchor is None or not result.scenes:
        return None

    analysis = result.scenes[0]
    beat_id, source_quote = anchor

    def usable(value: str, fallback: str) -> str:
        return value.strip() if is_usable_analysis_text(value) else fallback

    summary = usable(analysis.summary, overview)
    dramatic_function = usable(
        analysis.dramatic_function,
        f"The episode advances through this source-backed event: {overview}",
    )
    conflict = usable(
        analysis.conflict,
        f"The scene's immediate pressure is contained in this source-backed event: {overview}",
    )
    stakes = usable(
        analysis.stakes,
        f"What is at stake follows from this source-backed development: {overview}",
    )
    turn = usable(analysis.turn, overview)

    usable_moment = next(
        (
            moment
            for moment in analysis.key_moments
            if is_usable_analysis_text(moment.summary)
            and is_usable_analysis_text(moment.dramatic_function)
            and is_usable_analysis_text(moment.consequence)
        ),
        None,
    )
    moment = {
        "beatId": beat_id,
        "summary": usable_moment.summary if usable_moment else overview,
        "dramaticFunction": (
            usable_moment.dramatic_function if usable_moment else dramatic_function
        ),
        "consequence": (
            usable_moment.consequence
            if usable_moment
            else "This source-backed development sets the conditions for the next sequence."
        ),
        "sourceQuote": source_quote,
    }
    return {
        "sceneId": source_scene["sceneId"],
        "act": source_scene["act"],
        "location": source_scene["location"],
        "sourceKind": "narrative",
        "analysisStatus": "source_fallback",
        "analysisDiagnostics": [
            str(item.get("code", "unknown")) for item in diagnostics if isinstance(item, dict)
        ],
        "summary": summary,
        "focalCharacterName": analysis.focal_character_name,
        "dramaticFunction": dramatic_function,
        "conflict": conflict,
        "stakes": stakes,
        "turnBeatId": beat_id,
        "turn": turn,
        "keyMoments": [moment],
    }


def deterministic_non_narrative_packets(scene_sources: list[dict]) -> list[dict]:
    """Create honest packets for production metadata and connective images."""
    packets: list[dict] = []
    for scene in scene_sources:
        source_kind = scene.get("sourceKind")
        if source_kind not in {"front_matter", "establishing"}:
            continue
        anchor = _source_anchor(scene)
        summary = str(scene.get("overviewSummary") or "").strip()
        if anchor is None or not is_usable_analysis_text(summary):
            continue
        beat_id, source_quote = anchor
        if source_kind == "front_matter":
            dramatic_function = (
                "Identify production information before the episode's narrative action begins."
            )
            conflict = "No story conflict occurs in this production front-matter block."
            stakes = "No narrative stakes are introduced in this production-information block."
            turn = "The document advances through its production information toward the teaser."
            consequence = "The reader receives production context before the story begins."
        else:
            dramatic_function = "Orient the audience to location and time before the next action."
            conflict = "No direct conflict occurs in this brief establishing image."
            stakes = "The image supplies orientation rather than independent dramatic stakes."
            turn = "The episode shifts into a new location or time for the following action."
            consequence = "The audience is oriented for the dramatic action that follows."
        packets.append(
            {
                "sceneId": scene["sceneId"],
                "act": scene["act"],
                "location": scene["location"],
                "sourceKind": source_kind,
                "summary": summary,
                "focalCharacterName": None,
                "dramaticFunction": dramatic_function,
                "conflict": conflict,
                "stakes": stakes,
                "turnBeatId": beat_id,
                "turn": turn,
                "keyMoments": [
                    {
                        "beatId": beat_id,
                        "summary": summary,
                        "dramaticFunction": dramatic_function,
                        "consequence": consequence,
                        "sourceQuote": source_quote,
                    }
                ],
            }
        )
    return packets


def validate_scene_analysis_batch(
    source_chunk: list[dict], result: InferredNarrativeSceneAnalysisBatch
) -> list[dict]:
    """Validate prose/evidence and attach server-owned scene and beat ids.

    Narrative-map calls are intentionally one scene at a time. The server
    therefore already knows which scene the response describes and attaches
    authoritative evidence text from the cited beat. Model-returned ids are
    treated only as hints in single-beat scenes; a typo cannot discard otherwise
    grounded, paid analysis.
    """
    expected = {scene["sceneId"]: scene for scene in source_chunk}
    diagnostics: list[dict] = []
    if len(source_chunk) == 1 and len(result.scenes) == 1:
        analyses = [(result.scenes[0], source_chunk[0])]
    else:
        analyses = [(analysis, expected.get(analysis.scene_id)) for analysis in result.scenes]
        diagnostics.append(
            {
                "code": "scene_packet_coverage_incomplete",
                "expectedSceneIds": sorted(expected),
                "receivedSceneIds": sorted(scene.scene_id for scene in result.scenes),
            }
        )

    packets: list[dict] = []
    seen: set[str] = set()
    for index, (analysis, source_scene) in enumerate(analyses):
        path = f"scenes[{index}]"
        if source_scene is None:
            diagnostics.append(
                {"code": "unknown_scene", "path": path, "sceneId": analysis.scene_id}
            )
            continue
        scene_id = source_scene["sceneId"]
        if scene_id in seen:
            diagnostics.append({"code": "duplicate_scene_packet", "path": path})
            continue
        seen.add(scene_id)
        source_beats = source_scene["beats"]
        beats_by_id = {beat["beatId"]: beat for beat in source_beats}
        for field, value in (
            ("summary", analysis.summary),
            ("dramaticFunction", analysis.dramatic_function),
            ("conflict", analysis.conflict),
            ("stakes", analysis.stakes),
            ("turn", analysis.turn),
        ):
            if not is_usable_analysis_text(value):
                diagnostics.append({"code": "unusable_analysis_text", "path": f"{path}.{field}"})
        moments: list[dict] = []
        for moment_index, moment in enumerate(analysis.key_moments):
            moment_path = f"{path}.keyMoments[{moment_index}]"
            for field, value in (
                ("summary", moment.summary),
                ("dramaticFunction", moment.dramatic_function),
                ("consequence", moment.consequence),
            ):
                if not is_usable_analysis_text(value):
                    diagnostics.append(
                        {"code": "unusable_analysis_text", "path": f"{moment_path}.{field}"}
                    )
            beat = _moment_beat(source_beats, moment.beat_id)
            if beat is None:
                diagnostics.append(
                    {
                        "code": "moment_beat_not_in_source",
                        "path": moment_path,
                        "beatId": moment.beat_id,
                    }
                )
                continue
            anchor = _source_anchor_for_hint({"beats": [beat]}, moment.summary)
            if anchor is None:
                diagnostics.append({"code": "moment_has_no_source_anchor", "path": moment_path})
                continue
            moments.append(
                {
                    **moment.model_dump(by_alias=True),
                    "beatId": beat["beatId"],
                    "sourceQuote": anchor[1],
                }
            )
        if not moments:
            diagnostics.append({"code": "scene_has_no_grounded_moments", "path": path})
            continue
        turn_beat_id = (
            analysis.turn_beat_id if analysis.turn_beat_id in beats_by_id else moments[-1]["beatId"]
        )
        packets.append(
            {
                "sceneId": scene_id,
                "act": source_scene["act"],
                "location": source_scene["location"],
                "sourceKind": "narrative",
                "summary": analysis.summary,
                "focalCharacterName": analysis.focal_character_name,
                "dramaticFunction": analysis.dramatic_function,
                "conflict": analysis.conflict,
                "stakes": analysis.stakes,
                "turnBeatId": turn_beat_id,
                "turn": analysis.turn,
                "keyMoments": moments,
            }
        )

    if diagnostics:
        raise NarrativeMapAnalysisValidationError(diagnostics)
    return packets


def reusable_scene_packets(scene_sources: list[dict], prior_packets: list[dict]) -> list[dict]:
    """Revalidate prior-version checkpoints and return safe packets in source order."""
    prior_by_scene: dict[str, list[dict]] = {}
    for packet in prior_packets:
        if isinstance(packet, dict) and packet.get("sceneId"):
            prior_by_scene.setdefault(packet["sceneId"], []).append(packet)
    reusable: list[dict] = []
    for source_scene in scene_sources:
        for packet in prior_by_scene.get(source_scene["sceneId"], []):
            try:
                result = InferredNarrativeSceneAnalysisBatch.model_validate(
                    {
                        "scenes": [
                            {
                                "sceneId": packet.get("sceneId"),
                                "summary": packet.get("summary"),
                                "focalCharacterName": packet.get("focalCharacterName"),
                                "dramaticFunction": packet.get("dramaticFunction"),
                                "conflict": packet.get("conflict"),
                                "stakes": packet.get("stakes"),
                                "turnBeatId": packet.get("turnBeatId"),
                                "turn": packet.get("turn"),
                                "keyMoments": packet.get("keyMoments"),
                            }
                        ]
                    }
                )
                reusable.extend(validate_scene_analysis_batch([source_scene], result))
            except ValueError:
                continue
            break
    return reusable


def character_footprint(scene_packets: list[dict]) -> list[dict]:
    """How much of the episode each character actually carries, counted here.

    The synthesis is asked for arcs only where there is sustained on-page
    change, and it has the material to judge that — `focalCharacterName` is on
    every spine row. But judging it means counting across twenty-seven rows
    while doing everything else, and a character's standing in the world will
    beat an impression formed that way.

    President Bartlet is the case. He is focal in one scene of the West Wing
    pilot and named in three, arriving only at the end — and the synthesis gave
    him a full arc anyway, twice, inventing the specifics both times: a
    granddaughter named "Annie" (the excerpt says "my thirteen-year-old
    granddaughter"; the name appears to come from the Raggedy Ann doll beside
    it) and a want "to settle the Commandments argument", which the verifier
    called an invented detail not traceable to the evidence. The evidence gate
    caught both and dropped the arc, so the writer lost a character rather than
    read a fabrication — but it costs a full analysis' worth of that character
    every run.

    Counting it server-side turns "sustained on-page change" from a feeling
    into a number the model can read. Deliberately only `focal`: it is exact
    and server-owned, where counting mentions would mean matching names inside
    prose, and this session has already paid for one matcher that fired on a
    word inside a sentence.
    """
    counts: dict[str, list[str]] = {}
    for packet in scene_packets:
        name = str(packet.get("focalCharacterName") or "").strip()
        if name:
            counts.setdefault(name, []).append(packet["sceneId"])
    return [
        {"characterName": name, "focalSceneCount": len(scene_ids), "focalSceneIds": scene_ids}
        for name, scene_ids in sorted(counts.items(), key=lambda item: (-len(item[1]), item[0]))
    ]


def synthesis_scene_spine(scene_packets: list[dict]) -> list[dict]:
    """Return a compact, evidence-addressable macro context.

    The durable packets retain the full scene analysis for the final map. The
    synthesis needs only each scene's central event and turn, however. Sending
    every diagnostic and key-moment field again made a feature-length episode
    large enough that Opus could exhaust its response budget before completing
    the required strict-tool object.
    """

    def text(value: object, limit: int) -> str:
        return str(value or "").strip()[:limit]

    spine: list[dict] = []
    for packet in scene_packets:
        moments = packet.get("keyMoments") or []
        first_moment = moments[0] if moments and isinstance(moments[0], dict) else {}
        spine.append(
            {
                "sceneId": packet["sceneId"],
                "act": packet["act"],
                "sourceKind": packet.get("sourceKind", "narrative"),
                "analysisStatus": packet.get("analysisStatus", "accepted"),
                "summary": text(packet.get("summary"), 220),
                "focalCharacterName": packet.get("focalCharacterName"),
                "turnBeatId": packet["turnBeatId"],
                "turn": text(packet.get("turn"), 220),
                "keyMoment": {
                    "beatId": first_moment.get("beatId", packet["turnBeatId"]),
                    "summary": text(first_moment.get("summary"), 180),
                },
            }
        )
    return spine


def normalize_scene_packet_focal_characters(
    scene_packets: list[dict], known_cast: list[dict]
) -> tuple[list[dict], list[str]]:
    """Resolve focal labels to the saved cast before building persisted turns.

    A focal perspective is optional. When scene analysis names a person absent
    from the saved character bible, omitting that label is more accurate than
    inventing a character or rejecting an otherwise grounded map.
    """
    canonical_names: dict[str, str] = {}
    for character in known_cast:
        name = str(character.get("name") or "").strip()
        if not name:
            continue
        canonical_names[name.casefold()] = name
        for alias in character.get("aliases") or []:
            normalized_alias = str(alias or "").strip()
            if normalized_alias:
                canonical_names[normalized_alias.casefold()] = name

    normalized_packets: list[dict] = []
    repaired_scene_ids: list[str] = []
    for packet in scene_packets:
        normalized_packet = dict(packet)
        focal_name = normalized_packet.get("focalCharacterName")
        if isinstance(focal_name, str) and focal_name.strip():
            canonical_name = canonical_names.get(focal_name.strip().casefold())
            if canonical_name is None:
                normalized_packet["focalCharacterName"] = None
                repaired_scene_ids.append(str(normalized_packet["sceneId"]))
            elif canonical_name != focal_name:
                normalized_packet["focalCharacterName"] = canonical_name
        normalized_packets.append(normalized_packet)
    return normalized_packets, repaired_scene_ids


def _packet_quality_diagnostics(packet: dict) -> list[dict]:
    """Return quality failures that can occur in a durable scene checkpoint."""
    diagnostics: list[dict] = []
    for field in ("summary", "dramaticFunction", "conflict", "stakes", "turn"):
        if not is_usable_analysis_text(packet.get(field)):
            diagnostics.append({"code": "unusable_analysis_text", "path": field})
    for index, moment in enumerate(packet.get("keyMoments") or []):
        if not isinstance(moment, dict):
            diagnostics.append({"code": "invalid_key_moment", "path": f"keyMoments[{index}]"})
            continue
        for field in ("summary", "dramaticFunction", "consequence"):
            if not is_usable_analysis_text(moment.get(field)):
                diagnostics.append(
                    {"code": "unusable_analysis_text", "path": f"keyMoments[{index}].{field}"}
                )
    return diagnostics


def normalize_scene_packet_quality(
    scene_packets: list[dict], scene_sources: list[dict]
) -> tuple[list[dict], list[str]]:
    """Heal recoverable checkpoint filler from source-backed summaries.

    A strict tool schema can still accept a literal such as ``placeholder``.
    Rather than let that filler flow into a costly macro read, repair only the
    affected saved packet with the already-imported outline and source anchor.
    This never asks a model to invent a replacement and fails closed when the
    source cannot support a conservative fallback.
    """
    source_by_scene = {scene["sceneId"]: scene for scene in scene_sources}
    normalized: list[dict] = []
    repaired_scene_ids: list[str] = []

    for packet in scene_packets:
        source_scene = source_by_scene.get(packet.get("sceneId"))
        if source_scene is None or source_scene.get("sourceKind") != "narrative":
            normalized.append(packet)
            continue
        diagnostics = _packet_quality_diagnostics(packet)
        if not diagnostics:
            normalized.append(packet)
            continue
        try:
            result = InferredNarrativeSceneAnalysisBatch.model_validate(
                {
                    "scenes": [
                        {
                            "sceneId": packet.get("sceneId"),
                            "summary": packet.get("summary"),
                            "focalCharacterName": packet.get("focalCharacterName"),
                            "dramaticFunction": packet.get("dramaticFunction"),
                            "conflict": packet.get("conflict"),
                            "stakes": packet.get("stakes"),
                            "turnBeatId": packet.get("turnBeatId"),
                            "turn": packet.get("turn"),
                            "keyMoments": packet.get("keyMoments"),
                        }
                    ]
                }
            )
        except ValueError as exc:
            raise NarrativeMapAnalysisValidationError(
                [
                    *diagnostics,
                    {
                        "code": "scene_packet_repair_unavailable",
                        "sceneId": packet.get("sceneId"),
                    },
                ]
            ) from exc

        fallback = source_backed_scene_fallback(source_scene, result, diagnostics)
        if fallback is None:
            raise NarrativeMapAnalysisValidationError(
                [
                    *diagnostics,
                    {
                        "code": "scene_packet_repair_unavailable",
                        "sceneId": packet.get("sceneId"),
                    },
                ]
            )
        normalized.append(fallback)
        repaired_scene_ids.append(source_scene["sceneId"])

    return normalized, repaired_scene_ids


def _candidate_beat_ids(candidate: dict) -> set[str]:
    """Return every server-owned beat id cited by a map candidate."""
    beat_ids: set[str] = set()

    def add(value: object) -> None:
        if isinstance(value, str) and value:
            beat_ids.add(value)

    for theme in candidate.get("themes") or []:
        if isinstance(theme, dict):
            for evidence in theme.get("evidence") or []:
                if isinstance(evidence, dict):
                    add(evidence.get("beatId") or evidence.get("beat_id"))
    for act in candidate.get("acts") or []:
        if isinstance(act, dict):
            add(act.get("turnBeatId") or act.get("turn_beat_id"))
            # The beats the escalation rests on. Without these the verifier is
            # back to judging act-scoped prose against the turn beat's excerpt,
            # which is the whole failure this citation exists to end.
            for evidence in act.get("escalationEvidence") or act.get("escalation_evidence") or []:
                if isinstance(evidence, dict):
                    add(evidence.get("beatId") or evidence.get("beat_id"))
    journey = candidate.get("heroJourney") or candidate.get("hero_journey") or {}
    if isinstance(journey, dict):
        for stage in journey.get("stages") or []:
            if isinstance(stage, dict):
                add(stage.get("beatId") or stage.get("beat_id"))
    for arc in candidate.get("characterArcs") or candidate.get("character_arcs") or []:
        if isinstance(arc, dict):
            for point in arc.get("turningPoints") or arc.get("turning_points") or []:
                if isinstance(point, dict):
                    add(point.get("beatId") or point.get("beat_id"))
    for turn in candidate.get("sceneTurns") or candidate.get("scene_turns") or []:
        if isinstance(turn, dict):
            add(turn.get("turnBeatId") or turn.get("turn_beat_id"))
    for movement in candidate.get("threadMovements") or candidate.get("thread_movements") or []:
        if isinstance(movement, dict):
            add(movement.get("beatId") or movement.get("beat_id"))
    return beat_ids


def _bounded_script_excerpt(script_text: str) -> str:
    """Keep verification evidence inspectable without replaying a full screenplay."""
    text = script_text.strip()
    if len(text) <= NARRATIVE_MAP_VERIFICATION_EXCERPT_CHARS:
        return text
    separator = "\n[...]\n"
    half = (NARRATIVE_MAP_VERIFICATION_EXCERPT_CHARS - len(separator)) // 2
    return f"{text[:half].rstrip()}{separator}{text[-half:].lstrip()}"


def verification_audit_evidence(
    scene_sources: list[dict], scene_packets: list[dict], candidate: dict
) -> dict:
    """Build a bounded, citation-only evidence packet for independent audit.

    Scene and beat membership are already deterministic server checks. The
    verifier instead receives exact excerpts for only the beat ids the candidate
    cites, plus source-owned anchors selected during scene validation. This
    preserves independent review while avoiding a second full-screenplay bill.

    `act` on each beat, and `actScenes` for the full span, exist because an
    act's `escalation` and `dramaticQuestion` describe the whole act while its
    `turnBeatId` names one beat, and a verifier with no act membership can only
    judge the prose against that single excerpt. A real West Wing run rejected
    act 2's escalation for a detail its own advisory placed in scene-16 — which
    is inside act 2 (scenes 11-16). It found the evidence and called the claim
    unsupported anyway, because it was checking the wrong scope.

    `actScenes` lists every scene in the act, not just the ones with excerpts
    here, so absence is legible: a verifier that cannot see the scene a claim
    rests on knows it was not shown it, rather than reading silence as
    fabrication.
    """
    candidate_beat_ids = _candidate_beat_ids(candidate)
    quotes_by_beat: dict[str, list[str]] = {}
    for packet in scene_packets:
        for moment in packet.get("keyMoments") or []:
            if not isinstance(moment, dict):
                continue
            beat_id = moment.get("beatId")
            quote = str(moment.get("sourceQuote") or "").strip()
            if not isinstance(beat_id, str) or not quote:
                continue
            quotes = quotes_by_beat.setdefault(beat_id, [])
            if quote not in quotes and len(quotes) < NARRATIVE_MAP_VERIFICATION_QUOTES_PER_BEAT:
                quotes.append(quote)

    source_beats: list[dict] = []
    for scene in scene_sources:
        for beat in scene.get("beats") or []:
            beat_id = beat.get("beatId")
            if beat_id not in candidate_beat_ids:
                continue
            source_beats.append(
                {
                    "beatId": beat_id,
                    "sceneId": scene["sceneId"],
                    "act": scene.get("act"),
                    "sourceKind": scene.get("sourceKind"),
                    "scriptExcerpt": _bounded_script_excerpt(str(beat.get("scriptText") or "")),
                    "sourceQuotes": quotes_by_beat.get(beat_id, []),
                }
            )

    scenes_by_act: dict[int | None, list[str]] = {}
    for scene in scene_sources:
        scenes_by_act.setdefault(scene.get("act"), []).append(scene["sceneId"])

    return {
        "serverCheckedSceneIds": [scene["sceneId"] for scene in scene_sources],
        "candidateBeatIds": sorted(candidate_beat_ids),
        "actScenes": [
            {"act": act, "sceneIds": scene_ids}
            for act, scene_ids in sorted(
                scenes_by_act.items(), key=lambda item: (item[0] is None, item[0])
            )
        ],
        "sourceBeats": source_beats,
    }


def build_inferred_narrative_map(
    synthesis: InferredNarrativeMapSynthesis, scene_packets: list[dict]
) -> InferredNarrativeMap:
    """Join small, verified scene packets with the macro synthesis response."""
    return InferredNarrativeMap.model_validate(
        {
            **synthesis.model_dump(by_alias=True),
            "sceneTurns": [
                {
                    "sceneId": packet["sceneId"],
                    "focalCharacterName": packet["focalCharacterName"],
                    "dramaticFunction": packet["dramaticFunction"],
                    "conflict": packet["conflict"],
                    "stakes": packet["stakes"],
                    "turnBeatId": packet["turnBeatId"],
                    "turn": packet["turn"],
                }
                for packet in scene_packets
            ],
        }
    )


# The verifier writes these paths as prose, and it addresses list entries by
# whatever reads naturally — a theme's label, a character's name, a thread's
# id — not by the array index this module originally assumed. A real West Wing
# run produced `themes[Loyalty across shifting teams].evidence[beat-10-1]`,
# `characterArcs[Mandy].turningPoints[beat-15-4]` and
# `threadMovements[thread-b8f3...].beatId=beat-16-1`, none of which matched an
# index-only pattern. Every one of those is a removable optional claim, so the
# whole map was discarded over rejections the local repair was built to absorb.
# Accept any key here and resolve it against the candidate below.
_THEME_VERIFICATION_PATH = re.compile(r"^themes\[([^\]]+)\]")
_THREAD_INDEX_VERIFICATION_PATH = re.compile(r"^threadMovements\[(\d+)\]\s*$")
_THREAD_ID_VERIFICATION_PATH = re.compile(r"^threadMovements\[([^,\]]+),\s*beatId\s+([^\]]+)\]")
# Same claim, dotted form: `threadMovements[<threadId>].beatId=<beatId>`.
_THREAD_ID_DOT_VERIFICATION_PATH = re.compile(
    r"^threadMovements\[([^\]]+)\]\s*\.\s*beatId\s*=\s*(\S+)"
)
_CHARACTER_ARC_VERIFICATION_PATH = re.compile(r"^characterArcs\[([^\]]+)\](?:\.|\s|$)")
# "the map has no character arcs and should have" — a complaint about the
# section, not about an arc in it. `characterArcs[...]` addresses a member, so a
# path with no subscript can only mean the section itself. The `(empty ...)`
# form is the legacy spelling from when the verifier had no reason field and
# marked this case by writing the word into the path.
_EMPTY_CHARACTER_ARCS_VERIFICATION_PATH = re.compile(
    r"^characterArcs\s*(?:\(empty\b|$)"
)
# The same prose/structure split on a character arc. `characterName` is the
# record; want, need, internalConflict, externalPressure and arcSummary are
# readings of it, and each turning point is a separate claim anchored to a
# beat. Rejecting one of those used to delete the whole arc — a West Wing run
# lost C.J. entirely ("She sells certainty from the podium about matters her
# own staff won't confirm") over a single disputed turning point.
_CHARACTER_ARC_FIELDS = {
    "want": "want",
    "need": "need",
    "internalConflict": "internal_conflict",
    "externalPressure": "external_pressure",
    "arcSummary": "arc_summary",
}
_CHARACTER_ARC_FIELD_VERIFICATION_PATH = re.compile(
    r"^characterArcs\[([^\]]+)\]\s*\.\s*"
    r"(want|need|internalConflict|externalPressure|arcSummary)\b"
)
_CHARACTER_ARC_TURNING_POINT_VERIFICATION_PATH = re.compile(
    r"^characterArcs\[([^\]]+)\]\s*\.\s*turningPoints\b"
)
_BEAT_ID_IN_PATH = re.compile(r"\b(beat-[A-Za-z0-9_-]+)")
# An act's `escalation` is interpretive prose about how the act raises the
# stakes; the act number and `turnBeatId` are the structural coverage
# guarantee. A verifier that rejects the escalation claim is disputing the
# reading, not the turn — so clear the prose and keep the act, rather than
# discarding a map whose structure verified clean. The rejection must name
# `escalation` **as the field**: a bare `acts[1].turnBeatId=beat-6-5` disputes
# the turn itself and still fails closed, because an act with no turn is not
# coverage.
#
# Enforcing that needs the path to end at the field name. This used to allow
# anything between the index and the word (`acts\[([^\]]+)\][^\]]*`), which was
# survivable only while paths were pure. Once the verifier had a reason to give
# and no field to give it in, it began appending prose, and a real West Wing
# rejection — `acts[2].turnBeatId beat-12-6 escalation claim '...' — not
# evidenced at beat-12-6` — matched here on the word "escalation" inside the
# sentence. That fails open: it clears the escalation prose and keeps the very
# turn beat the verifier rejected. The reason has its own field now, so the path
# ends where the claim does.
_ACT_ESCALATION_VERIFICATION_PATH = re.compile(
    r"^acts\[([^\]]+)\]\s*\.?\s*escalation\s*$", re.IGNORECASE
)


# The same prose/structure split on a scene turn. `sceneId` and `turnBeatId`
# are the coverage guarantee; `dramaticFunction`, `conflict` and `stakes` are
# commentary about the scene. Rejections here cluster on establishing shots —
# a West Wing re-synthesis was rejected for the dramaticFunction it claimed on
# scenes 11, 13 and 21, all of which are bare establishing shots that the
# import itself already flagged as having no dramatic beat. Clearing the claim
# leaves the scene covered and says nothing untrue about it. `turn` and
# `evidenceQuote` are deliberately excluded: the first states the turn itself,
# and the second is `min(1)` in the contract, so neither can be blanked.
_SCENE_TURN_FIELDS = {
    "dramaticFunction": "dramatic_function",
    "conflict": "conflict",
    "stakes": "stakes",
}
_SCENE_TURN_PROSE_VERIFICATION_PATH = re.compile(
    r"^sceneTurns\[([^\]]+)\]\s*\.\s*(dramaticFunction|conflict|stakes)\b"
)


def _scene_turn_index_for(key: str, scene_turns: list) -> int | None:
    key = key.strip()
    if key.isdigit():
        index = int(key)
        return index if index < len(scene_turns) else None
    for index, turn in enumerate(scene_turns):
        if getattr(turn, "scene_id", None) == key:
            return index
    return None


def _act_index_for(key: str, acts: list) -> int | None:
    """Resolve an `acts[...]` key, which may be the act's own number or its
    position in the list. Act numbers are authoritative when they match, since
    a cold open makes them 0-based while a 4-act show still calls its first act
    one."""
    key = key.strip()
    if not key.isdigit():
        return None
    wanted = int(key)
    for index, act in enumerate(acts):
        if getattr(act, "act", None) == wanted:
            return index
    return wanted if wanted < len(acts) else None


def _index_for(key: str, items: list, *fields: str) -> int | None:
    """Resolve a verifier path key to a list index.

    ``key`` is either the array index this module used to require, or the
    human-readable identifier the verifier actually tends to write — matched
    case-insensitively against ``fields``. Returns None when it resolves to
    nothing, which the caller records as `verification_repair_path_unresolved`
    and fails closed on, exactly as before.
    """
    key = key.strip()
    if key.isdigit():
        index = int(key)
        return index if index < len(items) else None
    folded = key.casefold()
    for index, item in enumerate(items):
        for field in fields:
            value = getattr(item, field, None)
            if isinstance(value, str) and value.strip().casefold() == folded:
                return index
    return None


def verification_supports_local_repair(result: NarrativeMapVerification) -> bool:
    """Return whether a rejected verdict can be resolved without another model call.

    A verifier can identify an unsupported optional claim or complain that an
    optional section is empty. Removing the former and recording the latter as
    a coverage advisory is safer than paying to regenerate the entire map.
    Unknown paths and missing scenes still fail closed.
    """
    if result.missing_scene_ids or not result.unsupported_claims:
        return False
    return all(
        _THEME_VERIFICATION_PATH.match(claim.path)
        or _THREAD_INDEX_VERIFICATION_PATH.match(claim.path)
        or _THREAD_ID_VERIFICATION_PATH.match(claim.path)
        or _THREAD_ID_DOT_VERIFICATION_PATH.match(claim.path)
        or _CHARACTER_ARC_VERIFICATION_PATH.match(claim.path)
        or _EMPTY_CHARACTER_ARCS_VERIFICATION_PATH.match(claim.path)
        or _ACT_ESCALATION_VERIFICATION_PATH.match(claim.path)
        or _SCENE_TURN_PROSE_VERIFICATION_PATH.match(claim.path)
        for claim in result.unsupported_claims
    )


def _repaired_arc(arc, cleared_fields: set[str], dropped_beat_ids: set[str]):
    """Apply field clears and turning-point drops to one arc, keeping the arc."""
    if not cleared_fields and not dropped_beat_ids:
        return arc
    update: dict = {field: "" for field in cleared_fields}
    if dropped_beat_ids:
        update["turning_points"] = [
            point for point in arc.turning_points if point.beat_id not in dropped_beat_ids
        ]
    return arc.model_copy(update=update)


def repair_candidate_from_verification(
    candidate: InferredNarrativeMap,
    result: NarrativeMapVerification,
) -> tuple[InferredNarrativeMap, list[dict]]:
    """Prune verifier-rejected optional claims from a cached candidate.

    This is intentionally narrow. It never rewrites analytical prose, invents
    missing character arcs, or ignores missing scene coverage. A verifier path
    must resolve to a removable theme, character arc, or thread movement, or
    to an already empty character-arc section that is recorded as a coverage
    advisory.
    """
    diagnostics: list[dict] = []
    repairs: list[dict] = []
    theme_indexes: set[int] = set()
    character_arc_indexes: set[int] = set()
    movement_indexes: set[int] = set()
    cleared_escalation_indexes: set[int] = set()
    cleared_scene_turn_fields: dict[int, set[str]] = {}
    cleared_arc_fields: dict[int, set[str]] = {}
    dropped_turning_points: dict[int, set[str]] = {}

    if result.missing_scene_ids:
        diagnostics.extend(
            {"code": "verifier_missing_scene", "sceneId": scene_id}
            for scene_id in result.missing_scene_ids
        )

    for claim in result.unsupported_claims:
        path = claim.path
        theme_match = _THEME_VERIFICATION_PATH.match(path)
        if theme_match:
            resolved = _index_for(theme_match.group(1), candidate.themes, "label")
            if resolved is None:
                diagnostics.append({"code": "verification_repair_path_unresolved", "path": path})
                continue
            index = resolved
            theme_indexes.add(index)
            repairs.append(
                {
                    "action": "remove_theme",
                    "path": path,
                    "label": candidate.themes[index].label,
                }
            )
            continue

        arc_field_match = _CHARACTER_ARC_FIELD_VERIFICATION_PATH.match(path)
        if arc_field_match:
            resolved = _index_for(
                arc_field_match.group(1), candidate.character_arcs, "character_name"
            )
            field = _CHARACTER_ARC_FIELDS[arc_field_match.group(2)]
            if resolved is None:
                diagnostics.append({"code": "verification_repair_path_unresolved", "path": path})
                continue
            if not (getattr(candidate.character_arcs[resolved], field, "") or "").strip():
                diagnostics.append({"code": "verification_repair_path_unsupported", "path": path})
                continue
            cleared_arc_fields.setdefault(resolved, set()).add(field)
            repairs.append(
                {
                    "action": "clear_character_arc_claim",
                    "path": path,
                    "characterName": candidate.character_arcs[resolved].character_name,
                    "field": arc_field_match.group(2),
                }
            )
            continue

        turning_point_match = _CHARACTER_ARC_TURNING_POINT_VERIFICATION_PATH.match(path)
        if turning_point_match:
            resolved = _index_for(
                turning_point_match.group(1), candidate.character_arcs, "character_name"
            )
            if resolved is None:
                diagnostics.append({"code": "verification_repair_path_unresolved", "path": path})
                continue
            arc = candidate.character_arcs[resolved]
            named = {
                beat_id
                for beat_id in _BEAT_ID_IN_PATH.findall(path)
                if any(point.beat_id == beat_id for point in arc.turning_points)
            }
            already = dropped_turning_points.get(resolved, set())
            # The contract requires at least one turning point, so an arc that
            # would be left with none goes as a whole. Naming no identifiable
            # beat is the same case: the rejection is of the turning points
            # generally, and there is no single claim to drop.
            if named and len(already | named) < len(arc.turning_points):
                dropped_turning_points.setdefault(resolved, set()).update(named)
                repairs.append(
                    {
                        "action": "drop_character_arc_turning_point",
                        "path": path,
                        "characterName": arc.character_name,
                        "beatIds": sorted(named),
                    }
                )
            else:
                character_arc_indexes.add(resolved)
                repairs.append(
                    {
                        "action": "remove_character_arc",
                        "path": path,
                        "characterName": arc.character_name,
                    }
                )
            continue

        character_arc_match = _CHARACTER_ARC_VERIFICATION_PATH.match(path)
        if character_arc_match:
            resolved = _index_for(
                character_arc_match.group(1), candidate.character_arcs, "character_name"
            )
            if resolved is None:
                diagnostics.append({"code": "verification_repair_path_unresolved", "path": path})
                continue
            index = resolved
            character_arc_indexes.add(index)
            repairs.append(
                {
                    "action": "remove_character_arc",
                    "path": path,
                    "characterName": candidate.character_arcs[index].character_name,
                }
            )
            continue

        movement_index_match = _THREAD_INDEX_VERIFICATION_PATH.match(path)
        if movement_index_match:
            index = int(movement_index_match.group(1))
            if index >= len(candidate.thread_movements):
                diagnostics.append({"code": "verification_repair_path_unresolved", "path": path})
                continue
            movement_indexes.add(index)
            repairs.append({"action": "remove_thread_movement", "path": path})
            continue

        movement_id_match = _THREAD_ID_VERIFICATION_PATH.match(
            path
        ) or _THREAD_ID_DOT_VERIFICATION_PATH.match(path)
        if movement_id_match:
            thread_id, beat_id = movement_id_match.groups()
            matches = [
                index
                for index, movement in enumerate(candidate.thread_movements)
                if movement.thread_id == thread_id and movement.beat_id == beat_id
            ]
            if len(matches) == 1:
                movement_indexes.add(matches[0])
                repairs.append({"action": "remove_thread_movement", "path": path})
                continue

            # Older runs minted random persisted thread ids on every resume.
            # The beat id remains source-owned and stable, so remove every
            # movement on that beat rather than guessing which stale id the
            # verifier described.
            beat_matches = [
                index
                for index, movement in enumerate(candidate.thread_movements)
                if movement.beat_id == beat_id
            ]
            if not beat_matches:
                diagnostics.append({"code": "verification_repair_path_unresolved", "path": path})
                continue
            movement_indexes.update(beat_matches)
            repairs.append(
                {
                    "action": "remove_thread_movements_for_beat",
                    "path": path,
                    "beatId": beat_id,
                    "count": len(beat_matches),
                }
            )
            continue

        scene_turn_match = _SCENE_TURN_PROSE_VERIFICATION_PATH.match(path)
        if scene_turn_match:
            resolved = _scene_turn_index_for(scene_turn_match.group(1), candidate.scene_turns)
            field = _SCENE_TURN_FIELDS[scene_turn_match.group(2)]
            if resolved is None:
                diagnostics.append({"code": "verification_repair_path_unresolved", "path": path})
                continue
            if not (getattr(candidate.scene_turns[resolved], field, "") or "").strip():
                diagnostics.append({"code": "verification_repair_path_unsupported", "path": path})
                continue
            cleared_scene_turn_fields.setdefault(resolved, set()).add(field)
            repairs.append(
                {
                    "action": "clear_scene_turn_claim",
                    "path": path,
                    "sceneId": candidate.scene_turns[resolved].scene_id,
                    "field": scene_turn_match.group(2),
                }
            )
            continue

        act_escalation_match = _ACT_ESCALATION_VERIFICATION_PATH.match(path)
        if act_escalation_match:
            resolved = _act_index_for(act_escalation_match.group(1), candidate.acts)
            if resolved is None:
                diagnostics.append({"code": "verification_repair_path_unresolved", "path": path})
                continue
            if not (candidate.acts[resolved].escalation or "").strip():
                # Nothing to clear: the verifier is disputing something other
                # than the prose, so do not pretend this was repaired.
                diagnostics.append({"code": "verification_repair_path_unsupported", "path": path})
                continue
            cleared_escalation_indexes.add(resolved)
            repairs.append(
                {
                    "action": "clear_act_escalation",
                    "path": path,
                    "act": candidate.acts[resolved].act,
                }
            )
            continue

        if _EMPTY_CHARACTER_ARCS_VERIFICATION_PATH.match(path) and not candidate.character_arcs:
            repairs.append(
                {
                    "action": "record_coverage_advisory",
                    "path": path,
                    "section": "characterArcs",
                }
            )
            continue

        diagnostics.append({"code": "verification_repair_path_unsupported", "path": path})

    remaining_themes = [
        theme for index, theme in enumerate(candidate.themes) if index not in theme_indexes
    ]
    if not remaining_themes:
        diagnostics.append({"code": "verification_repair_removed_all_themes"})
    if diagnostics:
        raise NarrativeMapAnalysisValidationError(diagnostics)

    repaired = candidate.model_copy(
        update={
            "themes": remaining_themes,
            "character_arcs": [
                _repaired_arc(
                    arc,
                    cleared_arc_fields.get(index, set()),
                    dropped_turning_points.get(index, set()),
                )
                for index, arc in enumerate(candidate.character_arcs)
                if index not in character_arc_indexes
            ],
            "thread_movements": [
                movement
                for index, movement in enumerate(candidate.thread_movements)
                if index not in movement_indexes
            ],
            # The act stays — number, dramatic question and turn beat intact —
            # with only the disputed prose cleared, so act coverage survives.
            "scene_turns": [
                turn.model_copy(update={f: "" for f in cleared_scene_turn_fields[index]})
                if index in cleared_scene_turn_fields
                else turn
                for index, turn in enumerate(candidate.scene_turns)
            ],
            "acts": [
                act.model_copy(update={"escalation": ""})
                if index in cleared_escalation_indexes
                else act
                for index, act in enumerate(candidate.acts)
            ],
        },
        deep=True,
    )
    repairs.extend(
        {
            "action": "record_verifier_advisory",
            "path": advisory.path,
            "reason": advisory.reason,
        }
        for advisory in result.advisories
    )
    return repaired, repairs


def validate_verification(result: NarrativeMapVerification) -> None:
    """Require an explicit approval or a concrete blocking audit finding."""
    if result.approved and not result.unsupported_claims and not result.missing_scene_ids:
        return
    diagnostics = [
        {"code": "verifier_rejected", "path": claim.path, "reason": claim.reason}
        for claim in result.unsupported_claims
    ]
    diagnostics.extend(
        {"code": "verifier_missing_scene", "sceneId": scene_id}
        for scene_id in result.missing_scene_ids
    )
    if not diagnostics:
        diagnostics.append({"code": "verifier_rejected"})
    raise NarrativeMapAnalysisValidationError(diagnostics)
