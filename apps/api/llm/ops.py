"""Registry of Table Read's LLM operations (data contract §2a, plus
`BeatCandidate` from §2 reused by `generate_beat_candidates`/`tune_beat` per
docs/tableread-prompt-spec.md §1-§2). Single source of truth for: the tool
`name` used in `tool_choice` forcing, the output schema, and the
writer/classifier/import_worker/import_analyst model-role split (prompt spec §8):

- **classifier (Haiku):** grounded extraction / deterministic reads — blast
  radius, ledger facts, suggestions, consistency scan. Runs at temperature 0.
- **import_worker (Sonnet 5):** bounded, repeatable import work — per-scene
  segmentation and chunked entity extraction.
- **import_analyst (Opus 5):** story-wide import judgment — act inference,
  narrative promises, and story overview. Opus rejects non-default
  temperature; anthropic_client omits `temperature`.
- **writer (Sonnet 5):** synthesis / judgment, including the independent
  Narrative Map over the saved Opus breakdown. Writer-tier models also reject
  non-default temperature.
- **writer (Sonnet):** synthesis / judgment — beat candidates, tune,
  regenerate, scene skeleton. Writer-tier models reject non-default
  temperature; anthropic_client omits `temperature` for writer ops.

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

from dataclasses import dataclass
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
    InitialSceneSkeleton,
    InstructionSuggestions,
    LedgerExtraction,
    NarrativeMapVerification,
    NarrativePromises,
    RegeneratedElements,
    SegmentedScene,
    StoryEntities,
)

Role = Literal["writer", "classifier", "import_worker", "import_analyst"]
ToolChoiceMode = Literal["forced", "auto"]
EffortLevel = Literal["low", "medium", "high", "xhigh", "max"]


@dataclass(frozen=True)
class LlmOp:
    name: str  # tool name: matches tool_choice forcing and config/tool_schemas/<name>.json
    schema_name: str  # matches the Zod (packages/contract) / Pydantic (schemas.py) type name
    model: type[BaseModel]
    role: Role
    description: str  # short, non-creative: the Anthropic tool `description` field
    # Optional per-op ceiling. Import reads (entities, promises, fact extract,
    # segmentation, consistency scan, overview) return large structured
    # payloads; DEFAULT_MAX_TOKENS (4096) truncates mid-tool-input and
    # surfaces as SCHEMA_INVALID_LLM.
    max_tokens: int | None = None
    # Optional wall-clock ceiling for one Messages response (defaults to the
    # client's DEFAULT_LLM_CALL_TIMEOUT_SECONDS). Large max_tokens ops need
    # more headroom than beat-sized calls.
    call_timeout_seconds: float | None = None
    # Long, high-effort responses use the SDK's streaming accumulator so SSE
    # ping events keep the connection alive while still returning one complete
    # Message for the existing validation path.
    stream_response: bool = False
    # Forced tool choice IS compatible with adaptive thinking. The "must use
    # auto selection" restriction applies only to *manual* extended thinking
    # (`thinking: {type: "enabled", budget_tokens: N}`), which this codebase
    # never sends — see the Thinking-with-tool-use rules: "tool_choice options
    # that force tool use return an error with manual extended thinking;
    # adaptive thinking supports forced tool use." Keep ops that require a
    # structured response on "forced".
    tool_choice_mode: ToolChoiceMode = "forced"
    adaptive_thinking: bool = False
    # Disabling thinking on Claude Opus 5 has two documented failure modes:
    # the model may emit a tool call as plain text (the turn succeeds, the
    # call silently never runs, and no error is raised), and it may leak
    # `<thinking>` tags into the response. Both are worse here than the
    # thinking spend, because `_validate_tool_response` reads a missing
    # tool_use block as SCHEMA_INVALID_LLM. Prefer adaptive thinking at a
    # low/medium effort over disabling it.
    thinking_disabled: bool = False
    # NOTE: effort is rendered into the prompt, so two calls that differ only
    # by effort do NOT share a prompt-cache prefix. Ops intended to reuse one
    # cached source payload must agree on effort AND thinking config.
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
    ),
    LlmOp(
        "suggest_instructions",
        "InstructionSuggestions",
        InstructionSuggestions,
        "classifier",
        "Suggest three diverse scene or beat instructions for the writer to choose from.",
    ),
    # Import story breakdown (Opus / import_analyst): act structure from
    # segmented scene summaries. Omits temperature (Opus rejects non-default).
    LlmOp(
        "infer_act_breaks",
        "InferredActBreaks",
        InferredActBreaks,
        "import_analyst",
        "Infer ordered narrative act-start scene indices within the selected teleplay format.",
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
        max_tokens=8_192,
        call_timeout_seconds=180.0,
    ),
    # T7.19 narrative-promises P2. Runs after infer_story_entities and before
    # extract_ledger_facts (so motivations see the resolved cast) on
    # import_analyst (Opus) with the other import story-breakdown ops.
    LlmOp(
        "infer_narrative_promises",
        "NarrativePromises",
        NarrativePromises,
        "import_analyst",
        "Identify setup/payoff story threads, fill scene motivations, and "
        "extract structured world rules (limit/cost/exception) from the "
        "imported script, each with source evidence.",
        # The prompt carries every semantic beat plus bounded evidence. A
        # selective motivation policy keeps 12k ample while preventing an
        # oversized response from extending this import singleton indefinitely.
        max_tokens=12_288,
        call_timeout_seconds=300.0,
    ),
    # T7.27/T7.28 story overview (design 2026-07-17-import-story-overview):
    # Runs after infer_narrative_promises and before extract_ledger_facts.
    # Role: **import_analyst** (Opus 5) with the rest of import story
    # breakdown. Outline generation stays in this same single call (no second
    # op). Opus must not send temperature=0 (400 on non-default sampling).
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
        # mid-field at 8192 ("INT. WESTA"); match other large import ceilings.
        max_tokens=16_384,
        call_timeout_seconds=180.0,
    ),
    LlmOp(
        "infer_narrative_map",
        "InferredNarrativeMap",
        InferredNarrativeMap,
        "writer",
        "Build an evidence-grounded macro and micro narrative map: themes, acts, "
        "character arcs, scene turns, thread movements, and an optional Hero's Journey lens.",
        # The map is an explicit post-import synthesis. Sonnet 5 keeps the
        # large structured response under a practical UI timeout; Opus 5
        # remains responsible for the source breakdown it reads.
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
        max_tokens=8_192,
        call_timeout_seconds=180.0,
        # Forced: this op must return a structured scene analysis. Auto let the
        # model answer in prose instead, which surfaced as SCHEMA_INVALID_LLM.
        tool_choice_mode="forced",
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
        max_tokens=24_576,
        call_timeout_seconds=600.0,
        stream_response=True,
        tool_choice_mode="forced",
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
        max_tokens=8_192,
        call_timeout_seconds=300.0,
        stream_response=True,
        tool_choice_mode="forced",
        adaptive_thinking=True,
        effort="low",
        retry_schema_once=False,
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
        # Long scenes with many beats truncate mid-tool-input at 4096.
        max_tokens=16_384,
        call_timeout_seconds=180.0,
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
