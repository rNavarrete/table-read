"""Registry of Table Read's LLM operations (data contract §2a, plus
`BeatCandidate` from §2 reused by `generate_beat_candidates`/`tune_beat` per
docs/tableread-prompt-spec.md §1-§2). Single source of truth for: the tool
`name` used in `tool_choice` forcing, the output schema, and the
writer/classifier model-role split (prompt spec §8: "writer = §1 candidates,
§2 tune, §4 regenerate, §7 segmentation; classifier = §3 blast radius, §5
extraction, §6 suggestions, §8c consistency scan").

Consumed by `mock.py`/`anthropic_client.py` (dispatch + tool-schema lookup)
and by `scripts/generate_tool_schemas.py` (config/tool_schemas/ generation).

Naming note: the brief's "7 §2a ops" counts the 7 schema names diffed by
scripts/check_contract.py (BlastRadius, RegeneratedElements, ExtractedFact,
LedgerExtraction, InstructionSuggestions, SegmentedScene, ConsistencyScan).
`ExtractedFact` is a nested type (inside `LedgerExtraction`), not its own
tool call, while `ConsistencyScan` (op 8c, scan_consistency) *is* its own
call -- so the real operation count is 8: the 6 distinct ops those 7 schemas
produce, plus `generate_beat_candidates` and `tune_beat`, which both return
`BeatCandidate` (defined in §2, not §2a). All 8 are implemented here; see the
task report for this reconciliation.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel

from schemas import (
    BeatCandidate,
    BlastRadius,
    ConsistencyScan,
    InstructionSuggestions,
    LedgerExtraction,
    RegeneratedElements,
    SegmentedScene,
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
    # DESIGN-GAP(T6.1): prompt spec §7 mandates temperature 0 for stage-2
    # segmentation; current writer-tier models reject sampling params, so this
    # op runs at model default. Tracked by implementation: the T6.1
    # segmentation-determinism eval (apps/api/evals/checks.py) now measures
    # modal line-range agreement over the fixture; its 0.70 gate is soft and
    # flagged for PM ratification. Escalation if determinism regresses: move
    # this op to the classifier tier, which accepts temperature=0.
    LlmOp(
        "segment_scene",
        "SegmentedScene",
        SegmentedScene,
        "writer",
        "Segment one scene's line-numbered source text into beat boundaries as "
        "line ranges, with inferred beat-plan fields.",
    ),
    LlmOp(
        "scan_consistency",
        "ConsistencyScan",
        ConsistencyScan,
        "classifier",
        "Scan untouched scenes and beats for contradictions or tensions introduced "
        "by a recent change.",
    ),
)

OP_REGISTRY: dict[str, LlmOp] = {op.name: op for op in _OPS}
