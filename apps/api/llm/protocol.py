"""`LlmClient` -- the 10-operation Protocol both `MockLlmClient` and
`AnthropicClient` structurally satisfy (data contract §2a + §2's
`BeatCandidate`; see `llm/ops.py`'s module docstring for the "7 ops" naming
reconciliation).

Every method takes an already-rendered `system`/`user_message` pair rather
than a domain "context bundle" -- see `llm/__init__.py` for why prompt
construction stays out of this layer.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Protocol, runtime_checkable

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


@runtime_checkable
class LlmClient(Protocol):
    def generate_beat_candidates(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> BeatCandidate: ...

    def stream_beat_candidate(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> Iterator[str]:
        """Streaming variant of `generate_beat_candidates` (prompt spec §8a):
        yield the tool-input JSON **as raw fragments** (`input_json_delta`
        chunks — not guaranteed valid/complete JSON at any point). The caller
        (drama_manager/candidates.py) runs the incremental parser and final
        validation; this method never validates or yields display text."""
        ...

    def tune_beat(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> BeatCandidate: ...

    def stream_tune_beat(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> Iterator[str]:
        """Streaming variant of `tune_beat` (prompt spec §8a: candidates and
        tune both stream): yield the tool-input JSON as raw `input_json_delta`
        fragments. Like `stream_beat_candidate`, the caller
        (drama_manager/candidates.py) runs the incremental parser and final
        validation; this method never validates or yields display text."""
        ...

    def classify_blast_radius(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> BlastRadius: ...

    def regenerate_elements(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> RegeneratedElements: ...

    def extract_ledger_facts(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> LedgerExtraction: ...

    def suggest_instructions(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> InstructionSuggestions: ...

    def infer_act_breaks(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> InferredActBreaks: ...

    def infer_story_entities(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> StoryEntities: ...

    def infer_narrative_promises(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> NarrativePromises: ...

    def infer_story_overview(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> InferredStoryOverview: ...

    def infer_narrative_map(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> InferredNarrativeMap: ...

    def infer_narrative_scene_analysis(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> InferredNarrativeSceneAnalysisBatch: ...

    def infer_narrative_map_synthesis(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> InferredNarrativeMapSynthesis: ...

    def verify_narrative_map(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> NarrativeMapVerification: ...

    def segment_scene(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> SegmentedScene: ...

    def scan_consistency(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> ConsistencyScan: ...

    def generate_scene_skeleton(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> InitialSceneSkeleton: ...
