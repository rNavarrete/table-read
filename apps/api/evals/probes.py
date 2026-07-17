"""Fixture-derived inputs for the evals.

Every prompt an eval sends is built through the real product code paths — the
`render.py` §8b choke point and the `drama_manager` context selectors — never a
prompt string invented here (test plan line 26: the renderer is the only code
path producing prompt text). This module just wires fixture pieces into those
builders, so a schema-validity eval exercises the exact prompt production the
server ships.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from drama_manager import candidates, change_sets, render
from storage.seed import load_fixture

# The two fixture beats with real, multi-line scriptText — used to reconstruct
# a scene's source for the segmentation probe/eval and the extraction probe.
_CANDIDATE_SCENE = "scene-3"
_CANDIDATE_AFTER_BEAT = "beat-3-1"
_SEGMENT_SCENE = "scene-1"
_EXTRACT_SCENE = "scene-3"
_BLAST_TARGET = "beat-2-1"
_BLAST_INSTRUCTION = "Move the stolen money out of the bar and hide it at the marina instead."
_REGEN_ID = "beat-3-1"


@dataclass(frozen=True)
class FixtureCtx:
    """The fixture project ("The Long Pour") in the in-memory wire shapes the
    prompt builders consume."""

    doc: dict
    ledger: list[dict]

    @property
    def characters(self) -> list[dict]:
        return self.doc.get("seriesBible", {}).get("characters", [])

    @property
    def episode_id(self) -> str:
        return self.doc["seasons"][0]["episodes"][0]["id"]

    def scene(self, scene_id: str) -> dict:
        for _e, scene in _iter_scenes(self.doc):
            if scene["id"] == scene_id:
                return scene
        raise KeyError(scene_id)


def load_fixture_ctx() -> FixtureCtx:
    env = load_fixture()
    return FixtureCtx(doc=env["project"], ledger=env["ledger"])


def _iter_scenes(doc: dict):
    for season in doc.get("seasons", []):
        for episode in season.get("episodes", []):
            for scene in episode.get("scenes", []):
                yield episode, scene


def fixture_text_fragments(min_length: int = 20) -> list[str]:
    """Distinctive writer-text fragments from the fixture (script lines, plan
    fields, fact/source text, character sheets) — the forbidden-substring set
    for the runtime rule-5 report audit (`SuiteReport.write`). `min_length`
    filters out short generic strings that would false-positive against
    legitimate report prose."""
    env = load_fixture()
    doc, ledger = env["project"], env["ledger"]
    fragments: set[str] = set()

    def add(value) -> None:
        if isinstance(value, str):
            for line in value.split("\n"):
                line = line.strip()
                if len(line) >= min_length:
                    fragments.add(line)

    add(doc.get("premise"))
    for c in doc.get("seriesBible", {}).get("characters", []):
        for key in ("embodiment", "presentation", "hiding", "traits", "seriesArc", "summary", "bio"):
            add(c.get(key))
    for _e, scene in _iter_scenes(doc):
        for key in ("whatHappens", "audienceLearns", "audienceFeels", "socialSituation"):
            add(scene.get(key))
        for beat in scene.get("beats", []):
            for key in ("whatHappens", "audienceLearns", "audienceFeels", "scriptText"):
                add(beat.get(key))
    for fact in ledger:
        add(fact.get("fact"))
        add(fact.get("sourceText"))
    return sorted(fragments)


def scene_source_lines(scene: dict) -> list[str]:
    """Reconstruct a scene's line-numbered source (what a plain-text import would
    feed segmentation): the scene's beats' scriptText, concatenated and split to
    physical lines. Deterministic — the same input every run, so segmentation
    variance measures the model, not the input."""
    parts = [b.get("scriptText", "") for b in scene.get("beats", []) if b.get("scriptText")]
    return "\n\n".join(parts).split("\n")


def act_summaries_from_doc(doc: dict) -> list[dict]:
    return [
        {
            "sceneIndex": index,
            "location": scene.get("location", ""),
            "beats": [
                {
                    "whatHappens": beat.get("whatHappens", ""),
                    "audienceLearns": beat.get("audienceLearns", ""),
                    "audienceFeels": beat.get("audienceFeels", ""),
                }
                for beat in scene.get("beats", [])
            ],
        }
        for index, (_episode, scene) in enumerate(_iter_scenes(doc))
    ]


def act_boundary_cases(ctx: FixtureCtx) -> list[dict]:
    half_hour_events = [
        ("INT. KITCHEN - MORNING", "Nia hides a disastrous birthday cake before Jules enters."),
        ("INT. KITCHEN - LATER", "Jules mistakes the cover-up for a surprise party."),
        ("INT. OFFICE - DAY", "Nia recruits Omar to replace the cake before lunch."),
        ("EXT. BAKERY - DAY", "The bakery has lost Nia's replacement order."),
        ("INT. OFFICE - DAY", "Jules announces that the supposed party starts in an hour."),
        (
            "INT. KITCHEN - AFTERNOON",
            "Nia admits there was never a party and reveals the ruined cake.",
        ),
        (
            "INT. OFFICE - AFTERNOON",
            "The coworkers turn the failed cover-up into an improvised celebration.",
        ),
        ("INT. KITCHEN - EVENING", "Jules saves one terrible slice as a souvenir."),
    ]
    half_hour_summaries = [
        {
            "sceneIndex": index,
            "location": location,
            "beats": [
                {
                    "whatHappens": event,
                    "audienceLearns": "",
                    "audienceFeels": "",
                }
            ],
        }
        for index, (location, event) in enumerate(half_hour_events)
    ]
    one_hour_expected = []
    previous_act = None
    for index, (_episode, scene) in enumerate(_iter_scenes(ctx.doc)):
        if scene["act"] != previous_act:
            one_hour_expected.append(
                {"act": scene["act"], "startSceneIndex": index}
            )
            previous_act = scene["act"]
    return [
        {
            "caseId": "half-hour-cover-up",
            "project": {
                "title": "Half Hour Probe",
                "format": {
                    "genre": "comedy",
                    "runtimeMinutes": 30,
                    "actCount": 2,
                    "coldOpen": True,
                    "tag": False,
                    "serialization": 0.2,
                },
            },
            "summaries": half_hour_summaries,
            "expectedStarts": [
                {"act": 0, "startSceneIndex": 0},
                {"act": 1, "startSceneIndex": 2},
                {"act": 2, "startSceneIndex": 5},
            ],
        },
        {
            "caseId": "one-hour-long-pour",
            "project": ctx.doc,
            "summaries": act_summaries_from_doc(ctx.doc),
            "expectedStarts": one_hour_expected,
        },
    ]


# A prompt builder: fixture context -> (system, user). One per covered op.
PromptBuilder = Callable[[FixtureCtx], tuple[str, str]]


def _candidate_prompt(ctx: FixtureCtx) -> tuple[str, str]:
    return candidates.build_candidate_bundle(
        ctx.doc,
        ctx.ledger,
        scene_id=_CANDIDATE_SCENE,
        after_beat_id=_CANDIDATE_AFTER_BEAT,
        instruction="",
        avoid=[],
        nonce=render.new_nonce(),
    )


def _tune_prompt(ctx: FixtureCtx) -> tuple[str, str]:
    current = {
        "label": "Quiet reveal",
        "beatPlan": {
            "whatHappens": "placeholder candidate under revision",
            "audienceLearns": "placeholder",
            "audienceFeels": "placeholder",
        },
        "scriptText": "MARTA\nWe should talk about the books.",
        "continuityConflicts": [],
    }
    return candidates.build_tune_bundle(
        ctx.doc,
        ctx.ledger,
        scene_id=_CANDIDATE_SCENE,
        current_candidate=current,
        instruction="Make the exchange colder and more clipped.",
        nonce=render.new_nonce(),
    )


def _blast_radius_prompt(ctx: FixtureCtx) -> tuple[str, str]:
    return render.build_blast_radius_prompt(
        ctx.doc,
        episode_plan=change_sets._compact_episode_plan(ctx.doc),
        continuity_facts=change_sets._active_facts(ctx.ledger),
        target_object_id=_BLAST_TARGET,
        instruction=_BLAST_INSTRUCTION,
        nonce=render.new_nonce(),
    )


def _regenerate_prompt(ctx: FixtureCtx) -> tuple[str, str]:
    return render.build_regenerate_prompt(
        ctx.doc,
        regenerate_ids=[_REGEN_ID],
        instruction="Have Dan pitch the foreclosure fight harder and colder.",
        locked_siblings=[],
        neighbor_scenes=change_sets._neighbor_scene_summaries(ctx.doc, {_REGEN_ID}),
        continuity_facts=change_sets._active_facts(ctx.ledger),
        characters=ctx.characters,
        nonce=render.new_nonce(),
    )


def _extract_prompt(ctx: FixtureCtx) -> tuple[str, str]:
    scene = ctx.scene(_EXTRACT_SCENE)
    active = [f for f in ctx.ledger if f.get("status") == "active"]
    return render.build_extract_prompt(
        ctx.doc, ctx.episode_id, scene, active, ctx.characters, render.new_nonce()
    )


def _segment_prompt(ctx: FixtureCtx) -> tuple[str, str]:
    lines = scene_source_lines(ctx.scene(_SEGMENT_SCENE))
    return render.build_segment_prompt(ctx.doc, lines, render.new_nonce())


def _act_break_prompt(ctx: FixtureCtx) -> tuple[str, str]:
    return render.build_act_inference_prompt(
        ctx.doc, act_summaries_from_doc(ctx.doc), render.new_nonce()
    )


def _scan_prompt(ctx: FixtureCtx) -> tuple[str, str]:
    untouched = [
        {"id": s["id"], "location": s.get("location", ""), "whatHappens": s.get("whatHappens", "")}
        for _e, s in _iter_scenes(ctx.doc)
        if s["id"] != _CANDIDATE_SCENE
    ]
    active = [f for f in ctx.ledger if f.get("status") == "active"]
    change_summary = {"kind": "eval_probe", "objectIds": [_CANDIDATE_SCENE]}
    return render.build_scan_prompt(
        ctx.doc, change_summary, untouched, active, ctx.characters, render.new_nonce()
    )


def _suggest_prompt(ctx: FixtureCtx) -> tuple[str, str]:
    # Reuse the candidate scene context so §6 suggestions stay grounded.
    return render.build_suggest_prompt(
        ctx.doc,
        series={"premise": ctx.doc.get("premise", ""), "theme": ""},
        characters=ctx.characters,
        episode={"premise": ""},
        scene_plan={"n": 3, "whatHappens": "Confrontation"},
        continuity_facts=[],
        locked_beats=[],
        previous_script="",
        next_beat_plan=None,
        surface="command_bar",
        nonce=render.new_nonce(),
    )



def _overview_prompt(ctx: FixtureCtx) -> tuple[str, str]:
    scene = ctx.scene("scene-1")
    beats = scene.get("beats") or []
    beat_id = beats[0]["id"] if beats else "beat-1-1"
    beat0 = beats[0] if beats else {}
    what = beat0.get("whatHappens", "") or scene.get("whatHappens", "")
    scene_spine = [
        {
            "sceneId": scene["id"],
            "act": scene.get("act", 0),
            "location": scene.get("location", ""),
            "whatHappens": what,
            "audienceLearns": beat0.get("audienceLearns", ""),
            "audienceFeels": beat0.get("audienceFeels", ""),
            "scriptExcerpt": (beat0.get("scriptText") or "")[:400],
        }
    ]
    known_beats = [
        {
            "beatId": beat_id,
            "sceneId": scene["id"],
            "whatHappens": what,
            "audienceLearns": beat0.get("audienceLearns", ""),
            "audienceFeels": beat0.get("audienceFeels", ""),
        }
    ]
    cast = [c.get("name", "") for c in ctx.characters if c.get("name")]
    return render.build_overview_prompt(
        ctx.doc,
        scene_spine,
        known_beats,
        render.new_nonce(),
        known_cast=cast,
    )


# op name -> prompt builder. Every op here has a real render builder + call site
# in the product code.
SCHEMA_PROBES: dict[str, PromptBuilder] = {
    "generate_beat_candidates": _candidate_prompt,
    "tune_beat": _tune_prompt,
    "classify_blast_radius": _blast_radius_prompt,
    "regenerate_elements": _regenerate_prompt,
    "extract_ledger_facts": _extract_prompt,
    "infer_act_breaks": _act_break_prompt,
    "segment_scene": _segment_prompt,
    "scan_consistency": _scan_prompt,
    "suggest_instructions": _suggest_prompt,
    "infer_story_overview": _overview_prompt,
}
