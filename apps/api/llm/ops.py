"""Registry of Table Read's LLM operations (data contract §2a, plus
`BeatCandidate` from §2 reused by `generate_beat_candidates`/`tune_beat` per
docs/tableread-prompt-spec.md §1-§2). Single source of truth for: the tool
`name` used in `tool_choice` forcing, the output schema, and the
writer/classifier model-role split (prompt spec §8, with the T6.1 escalation
applied: "writer = §1 candidates, §2 tune, §4 regenerate; classifier = §3 blast
radius, §5 extraction, §6 suggestions, §7 segmentation, §8c consistency scan").
§7 segmentation moved writer→classifier so it can run at temperature 0 (§7);
see the note at its LlmOp below.

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
schema/registry only; T7.20 owns its prompt/pipeline wiring. All 10 are
implemented here; see the task report for this reconciliation.
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
    InitialSceneSkeleton,
    InstructionSuggestions,
    LedgerExtraction,
    NarrativePromises,
    RegeneratedElements,
    SegmentedScene,
    StoryEntities,
)

Role = Literal["writer", "classifier"]


@dataclass(frozen=True)
class LlmOp:
    name: str  # tool name: matches tool_choice forcing and config/tool_schemas/<name>.json
    schema_name: str  # matches the Zod (packages/contract) / Pydantic (schemas.py) type name
    model: type[BaseModel]
    role: Role
    description: str  # short, non-creative: the Anthropic tool `description` field


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
        "List objects impacted by a proposed plan edit, each with a reason and a "
        "confidence level.",
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
    ),
    LlmOp(
        "suggest_instructions",
        "InstructionSuggestions",
        InstructionSuggestions,
        "classifier",
        "Suggest three diverse scene or beat instructions for the writer to "
        "choose from.",
    ),
    LlmOp(
        "infer_act_breaks",
        "InferredActBreaks",
        InferredActBreaks,
        "classifier",
        "Infer ordered narrative act-start scene indices within the selected teleplay format.",
    ),
    # §5a import-time entity inference (T7.15 import-continuity-mvp; Task 1
    # of that plan adds schema/registry only -- Task 2 owns the prompt,
    # pipeline wiring, and PROMPT_VERSION bump). Runs between act inference
    # and fact extraction, classifier role/temperature 0 (a deterministic
    # cast/relationship/world-element read, not a creative task); names are
    # strings the server resolves/mints against the existing bible, never
    # model-assigned ids.
    LlmOp(
        "infer_story_entities",
        "StoryEntities",
        StoryEntities,
        "classifier",
        "Identify characters (including non-speaking ones), relationships, and "
        "world elements (locations/objects) implied by the imported script, "
        "each with source evidence.",
    ),
    # T7.19 narrative-promises P2 (design doc 2026-07-16-narrative-promises-design):
    # Task 1 of that plan adds schema/registry only -- Task 2 (T7.20) owns the
    # prompt, pipeline wiring, and PROMPT_VERSION bump. Runs after
    # infer_story_entities and before extract_ledger_facts (so motivations see
    # the resolved cast), classifier role/temperature 0 for the same reason as
    # infer_story_entities -- this is a source-grounded read, not a creative task.
    LlmOp(
        "infer_narrative_promises",
        "NarrativePromises",
        NarrativePromises,
        "classifier",
        "Identify setup/payoff story threads, fill scene motivations, and "
        "extract structured world rules (limit/cost/exception) from the "
        "imported script, each with source evidence.",
    ),
    # T6.1 escalation EXECUTED: prompt spec §7 mandates temperature 0 for stage-2
    # segmentation, but the writer tier rejects sampling params, so under the
    # original writer-role pinning the op ran at model default and the
    # segmentation-determinism eval regressed below its soft 0.70 gate (0.25). The
    # documented escalation — move the op to the classifier tier, which accepts
    # temperature=0 — is now applied: `segment_scene` is classifier-role, so
    # anthropic_client sends temperature=0 (prompt spec §7), and §7's temperature
    # requirement is honored. (The gate threshold itself is still chosen-not-pinned;
    # that ratification remains DESIGN-GAP(T6.1) at the eval's gate constant.)
    LlmOp(
        "segment_scene",
        "SegmentedScene",
        SegmentedScene,
        "classifier",
        "Segment one scene's numbered source objects into typed segment starts "
        "with inferred beat-plan fields; the server derives end lines.",
    ),
    LlmOp(
        "scan_consistency",
        "ConsistencyScan",
        ConsistencyScan,
        "classifier",
        "Scan untouched scenes and beats for contradictions or tensions introduced "
        "by a recent change.",
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
