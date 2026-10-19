"""Registry of Table Read's LLM operations (data contract §2a, plus
`BeatCandidate` from §2 reused by `generate_beat_candidates`/`tune_beat` per
docs/tableread-prompt-spec.md §1-§2). Single source of truth for: the tool
`name` each call offers and asks for, the output schema, and the
writer/classifier/import_worker/import_analyst model-role split (prompt spec §8):

- **classifier (Haiku 5.5):** grounded extraction / deterministic reads — blast
  radius, ledger facts, suggestions, consistency scan. Runs at low effort.
- **import_worker (Sonnet 5.5):** bounded, repeatable import work — per-scene
  segmentation and chunked entity extraction.
- **import_analyst (Opus 5.5):** story-wide import judgment — act inference,
  narrative promises, and story overview.
- **writer (Sonnet 5.5):** synthesis / judgment — beat candidates, tune,
  regenerate, scene skeleton, and the independent Narrative Map verifier.

No role sends `temperature`: every pinned model rejects a non-default value
(config/models.toml).

Reassigning import story-breakdown ops onto `import_analyst` is a versioned
model-path change — requires `make evals` sign-off before merge
(PROMPT_VERSION unchanged when prompt text is untouched).

Consumed by `mock.py`/`anthropic_client.py` (dispatch + tool-schema lookup)
and by `scripts/generate_tool_schemas.py` (config/tool_schemas/ generation).

Naming note: the brief's "7 §2a ops" counts the 7 schema names diffed by
scripts/check_contract.py (BlastRadius, RegeneratedElements, ExtractedFact,
LedgerExtraction, InstructionSuggestions, SegmentedScene, ConsistencyScan).
`ExtractedFact` is a nested type (inside `LedgerExtraction`), not its own
tool call, while `ConsistencyScan` (op 8c, scan_consistency) *is* its own
call -- so the real operation count was 8: the 6 distinct ops those 7 schemas
produce, plus `generate_beat_candidates` and `tune_beat`, which both return
`BeatCandidate` (defined in §2, not §2a). T-continuity Task 1 adds a 9th,
`infer_story_entities` (§5a, StoryEntities) -- schema/registry only here;
Task 2 owns its prompt/pipeline wiring. Narrative-promises (P2) Task 1 (T7.19)
adds a 10th, `infer_narrative_promises` (NarrativePromises) -- again
schema/registry only; T7.20 owns its prompt/pipeline wiring. T7.27 adds
an 11th, `infer_story_overview` (InferredStoryOverview) -- schema/
registry only here; T7.28 owns its prompt/pipeline wiring.
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

from schemas import (
    BeatCandidate,
    BlastRadius,
    ConsistencyScan,
    InferredActBreaks,
    InferredNarrativeMap,
    InferredNarrativeMapSynthesis,
    InferredNarrativeSceneAnalysisBatch,
    InferredStoryOverview,
    InferredStructureCheck,
    InitialSceneSkeleton,
    InstructionSuggestions,
    LedgerExtraction,
    NarrativeMapVerification,
    NarrativePromises,
    RegeneratedElements,
    SegmentedScene,
    StoryEntities,
    StructureCheckVerification,
)

Role = Literal["writer", "classifier", "import_worker", "import_analyst"]
EffortLevel = Literal["low", "medium", "high", "xhigh", "max"]


@dataclass(frozen=True)
class LlmOp:
    name: str  # tool name: the one tool the call offers; config/tool_schemas/<name>.json
    schema_name: str  # matches the Zod (packages/contract) / Pydantic (schemas.py) type name
    model: type[BaseModel]
    role: Role
    description: str  # short, non-creative: the Anthropic tool `description` field
    # Optional per-op ceiling. Import reads (entities, promises, fact extract,
    # segmentation, consistency scan, overview) return large structured
    # payloads; a ceiling that is too small truncates mid-tool-input and
    # surfaces as SCHEMA_INVALID_LLM. Thinking counts toward it on every
    # pinned 5.5 model, so ceilings cover reasoning plus the reply.
    max_tokens: int | None = None
    # Optional wall-clock ceiling for one Messages response (defaults to the
    # client's DEFAULT_LLM_CALL_TIMEOUT_SECONDS). Large max_tokens ops need
    # more headroom than beat-sized calls.
    call_timeout_seconds: float | None = None
    # Long, high-effort responses use the SDK's streaming accumulator so SSE
    # ping events keep the connection alive while still returning one complete
    # Message for the existing validation path.
    stream_response: bool = False
    # Every pinned model thinks adaptively when `thinking` is omitted; this
    # only makes it explicit. Opus 5.5 and Sonnet 5.5 reject disabled thinking,
    # so effort is the only way to spend less on it.
    adaptive_thinking: bool = False
    # NOTE: effort is rendered into the prompt, so two calls that differ only
    # by effort do NOT share a prompt-cache prefix. Ops intended to reuse one
    # cached source payload must agree on effort AND thinking config. Omitted
    # means the model's default: `medium` on Opus 5.5 and Haiku 5.5, `high` on
    # Sonnet 5.5.
    effort: EffortLevel | None = None
    # Schema repair is useful for generative calls, but a duplicate verifier
    # verdict is unnecessary spend. Operations can fail closed after the first
    # malformed response instead.
    retry_schema_once: bool = True


_OPS: tuple[LlmOp, ...] = (
    LlmOp(
        "generate_beat_candidates",
        "BeatCandidate",
        BeatCandidate,
        "writer",
        "Generate one labeled Next Beat candidate (structural plan plus Fountain "
        "script text) for the given scene context.",
    ),
    LlmOp(
        "tune_beat",
        "BeatCandidate",
        BeatCandidate,
        "writer",
        "Revise an existing beat candidate per a short tune instruction; the label "
        "may change if the intent changed.",
    ),
    LlmOp(
        "classify_blast_radius",
        "BlastRadius",
        BlastRadius,
        "classifier",
        "List objects impacted by a proposed plan edit, each with a reason and a confidence level.",
        effort="low",
    ),
    LlmOp(
        "regenerate_elements",
        "RegeneratedElements",
        RegeneratedElements,
        "writer",
        "Regenerate the approved, unlocked beats and scenes named in a Change Set.",
    ),
    LlmOp(
        "extract_ledger_facts",
        "LedgerExtraction",
        LedgerExtraction,
        "classifier",
        "Extract new continuity facts and flag contradictions with existing facts "
        "from an accepted script delta.",
        # Dense import scenes (many beats × facts × knowledgeEvents) truncate
        # at DEFAULT_MAX_TOKENS mid-tool-input → SCHEMA_INVALID_LLM.
        max_tokens=16_384,
        call_timeout_seconds=300.0,
        effort="low",
    ),
    LlmOp(
        "suggest_instructions",
        "InstructionSuggestions",
        InstructionSuggestions,
        "classifier",
        "Suggest three diverse scene or beat instructions for the writer to choose from.",
        effort="low",
    ),
    # Import story breakdown (Opus / import_analyst): act structure from
    # segmented scene summaries. Opus 5.5 at `medium` already exceeds Opus 5 at
    # its `high` default, so `medium` is set explicitly (as on promises and
    # overview), with room for thinking before the call.
    LlmOp(
        "infer_act_breaks",
        "InferredActBreaks",
        InferredActBreaks,
        "import_analyst",
        "Infer ordered narrative act-start scene indices within the selected teleplay format.",
        max_tokens=16_384,
        call_timeout_seconds=300.0,
        effort="medium",
    ),
    # §5a import-time entity inference (T7.15). This is bounded extraction,
    # not story-wide judgment, so it runs on the Sonnet import worker.
    LlmOp(
        "infer_story_entities",
        "StoryEntities",
        StoryEntities,
        "import_worker",
        "Identify characters (including non-speaking ones), relationships, and "
        "world elements (locations/objects) implied by the imported script, "
        "each with source evidence. betweenNames must be exactly two name "
        "strings; every entity needs at least one evidence item.",
        # A real 77-speaker chunk spent all 16_384 on thinking plus a partial
        # reply (stop_reason=max_tokens) and paid a full retry. `medium` is
        # enough for a bounded listing job (Sonnet 5.5 defaults to `high`),
        # and the ceiling streams because the SDK refuses one this large on a
        # plain request.
        max_tokens=32_768,
        call_timeout_seconds=180.0,
        stream_response=True,
        effort="medium",
    ),
    # T7.19 narrative-promises P2. Runs after infer_story_entities and before
    # extract_ledger_facts (so motivations see the resolved cast) on
    # import_analyst (Opus) with the other import story-breakdown ops.
    LlmOp(
        "infer_narrative_promises",
        "NarrativePromises",
        NarrativePromises,
        "import_analyst",
        "Identify setup/payoff story threads and the episode's storylines "
        "(A-D), fill scene motivations, and extract structured world rules "
        "(limit/cost/exception) from the imported script, each with source "
        "evidence.",
        # The prompt carries every semantic beat plus bounded evidence. A
        # selective motivation policy keeps 12k ample for the reply while
        # preventing an oversized response from extending this import
        # singleton indefinitely; the rest is room for thinking.
        max_tokens=24_576,
        # 300s was calibrated while the beat layer was empty: segment_scene
        # returned only `unassigned`, so "every semantic beat" was 27 blank
        # strings. With the strict-grammar fix the same episode carries 109
        # real beats and a ~72k-char prompt, and this call timed out. Long
        # Opus responses stream so SSE pings hold the connection open, same
        # as infer_narrative_map_synthesis.
        call_timeout_seconds=600.0,
        stream_response=True,
        effort="medium",
    ),
    # T7.27/T7.28 story overview (design 2026-07-17-import-story-overview):
    # Runs after infer_narrative_promises and before extract_ledger_facts.
    # Role: **import_analyst** (Opus) with the rest of import story
    # breakdown. Outline generation stays in this same single call (no second
    # op).
    # Role reassignment is a versioned model-path change — requires `make evals`
    # sign-off before merge (PROMPT_VERSION unchanged when prompt text untouched).
    LlmOp(
        "infer_story_overview",
        "InferredStoryOverview",
        InferredStoryOverview,
        "import_analyst",
        "Infer an episode logline, scene-ordered outline, named beat sheet "
        "anchored to existing beat ids, and a two-paragraph present-tense "
        "synopsis from the imported script.",
        # Large episodes (many outline rows + beat sheet + synopsis) truncated
        # mid-field at 8192 ("INT. WESTA"); 16k for the reply plus room for
        # thinking.
        max_tokens=32_768,
        # Same recalibration as infer_narrative_promises above: this reads the
        # beat spine too, and its 180s was the tightest ceiling in the import
        # path despite the largest output budget. Fixing only promises would
        # have moved the failure one stage later.
        call_timeout_seconds=600.0,
        stream_response=True,
        effort="medium",
    ),
    LlmOp(
        "infer_narrative_map",
        "InferredNarrativeMap",
        InferredNarrativeMap,
        "writer",
        "Build an evidence-grounded macro and micro narrative map: themes, acts, "
        "character arcs, scene turns, thread movements, and an optional Hero's Journey lens.",
        # The map is an explicit post-import synthesis. The writer model keeps
        # the large structured response under a practical UI timeout; the
        # import analyst remains responsible for the source breakdown it reads.
        max_tokens=16_384,
        call_timeout_seconds=180.0,
    ),
    LlmOp(
        "infer_narrative_scene_analysis",
        "InferredNarrativeSceneAnalysisBatch",
        InferredNarrativeSceneAnalysisBatch,
        "import_analyst",
        "Analyze exactly one saved screenplay scene into an evidence-backed dramatic "
        "turn and key moments. Read the supplied scriptText as the authoritative source, "
        "write concrete scene-specific prose, and cite each moment with a supplied beatId; "
        "the server attaches the authoritative excerpt. Never return placeholders, "
        "generic boilerplate, invented evidence, "
        "or claims that the supplied source is insufficient.",
        # A bounded chunk avoids the giant all-episode response that previously
        # timed out after spending tokens without yielding a usable map.
        max_tokens=16_384,
        call_timeout_seconds=180.0,
        adaptive_thinking=True,
        effort="medium",
    ),
    LlmOp(
        "infer_narrative_map_synthesis",
        "InferredNarrativeMapSynthesis",
        InferredNarrativeMapSynthesis,
        "import_analyst",
        "Synthesize evidence-grounded episode structure, themes, character arcs, "
        "threads, and an optional Hero's Journey lens from verified scene analysis. "
        "Every claim must use the supplied scene packets and their source-owned beat IDs; "
        "never add unsupported events, motives, or generic placeholder analysis.",
        # Thinking counts toward max_tokens, so this ceiling covers reasoning
        # plus the large structured map.
        max_tokens=32_768,
        call_timeout_seconds=600.0,
        stream_response=True,
        adaptive_thinking=True,
        effort="medium",
        retry_schema_once=False,
    ),
    LlmOp(
        "verify_narrative_map",
        "NarrativeMapVerification",
        NarrativeMapVerification,
        "writer",
        "Independently verify whether a proposed Narrative Map is supported by the supplied "
        "screenplay source and scene analysis. Approve only concrete claims traceable to the "
        "supplied evidence, and identify every unsupported path or missing scene without "
        "rewriting or inventing the analysis.",
        # Headroom for reasoning plus the verdict; a truncated response has no
        # tool_use block and fails closed (retry_schema_once=False).
        max_tokens=16_384,
        call_timeout_seconds=300.0,
        stream_response=True,
        adaptive_thinking=True,
        effort="low",
        retry_schema_once=False,
    ),
    # Structure checklist (spec 2026-10-11): one synchronous POST runs one
    # check plus one verify, so the ceilings stay small and nothing streams.
    # Both keep the default one schema retry (rule 9).
    LlmOp(
        "check_structure",
        "InferredStructureCheck",
        InferredStructureCheck,
        "import_analyst",
        "Judge each stage of one story structure against the script's breakdown.",
        max_tokens=16_384,
        call_timeout_seconds=150.0,
        adaptive_thinking=True,
        effort="medium",
    ),
    LlmOp(
        "verify_structure_check",
        "StructureCheckVerification",
        StructureCheckVerification,
        "writer",
        "Judge whether each cited excerpt shows the claimed structure stage.",
        max_tokens=8_192,
        call_timeout_seconds=90.0,
        adaptive_thinking=True,
        effort="low",
    ),
    # Import story breakdown: per-scene beat segmentation on Sonnet. Historical
    # note: T6.1 moved segment_scene writer→classifier for temperature=0; the
    # import worker prioritizes quality while keeping repeatable scene work
    # materially cheaper than Opus. The
    # segmentation soft gate may need re-check at `make evals` (DESIGN-GAP(T6.1)
    # threshold ratification still open).
    LlmOp(
        "segment_scene",
        "SegmentedScene",
        SegmentedScene,
        "import_worker",
        "Segment one scene's numbered source objects into typed segment starts "
        "with inferred beat-plan fields; the server derives end lines.",
        # Long scenes with many beats truncate mid-tool-input at 4096; 16k for
        # the reply plus room for thinking, streamed (the SDK refuses a
        # ceiling this large on a plain request).
        max_tokens=32_768,
        call_timeout_seconds=180.0,
        stream_response=True,
    ),
    LlmOp(
        "scan_consistency",
        "ConsistencyScan",
        ConsistencyScan,
        "classifier",
        "Scan untouched scenes and beats for contradictions or tensions introduced "
        "by a recent change.",
        # Post-import scans over large scripts can emit many flags.
        max_tokens=16_384,
        call_timeout_seconds=300.0,
        effort="low",
    ),
    # §9.4 guided-setup scene skeleton (new-project-flow design spec §6/§9.4):
    # writer-role, one diverse candidate per call, driven 3x by
    # drama_manager/scene_skeleton.py's convergent loop (mirrors the §1 beat
    # candidate diversity mechanic). Never sets ids or scriptText.
    LlmOp(
        "generate_scene_skeleton",
        "InitialSceneSkeleton",
        InitialSceneSkeleton,
        "writer",
        "Propose an ordered set of new scenes (with beat-plan seeds) that "
        "opens a season's first episode, given the project's premise, "
        "format, and story foundation.",
    ),
)

OP_REGISTRY: dict[str, LlmOp] = {op.name: op for op in _OPS}

MODELS_CONFIG_PATH = Path(__file__).resolve().parents[3] / "config" / "models.toml"


def model_pins() -> dict[str, str]:
    """Role -> pinned model id, from config/models.toml."""
    with MODELS_CONFIG_PATH.open("rb") as f:
        return tomllib.load(f)["models"]
