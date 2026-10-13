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
        self,
        *,
        system: str,
        user_message: str,
        prompt_version: str,
        cache_prefix: str | None = None,
    ) -> LedgerExtraction:
        """`cache_prefix` is a stable per-run source payload (the whole episode
        script) sent as a cached system block, so a per-scene loop can see the
        surrounding episode for ~0.1x input after the first call. It must be
        byte-identical across the run — see `render.build_episode_source_block`."""
        ...

    def suggest_instructions(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> InstructionSuggestions: ...

    def infer_act_breaks(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> InferredActBreaks: ...

    def infer_story_entities(
        self,
        *,
        system: str,
        user_message: str,
        prompt_version: str,
        cache_prefix: str | None = None,
    ) -> StoryEntities:
        """`cache_prefix` is the whole split script. Chunking bounds the
        OUTPUT (see `render.build_entity_prompt`); the prefix means a chunk
        boundary no longer costs the model sight of the rest of the cast."""
        ...

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

    def check_structure(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> InferredStructureCheck: ...

    def verify_structure_check(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> StructureCheckVerification: ...

    def segment_scene(
        self,
        *,
        system: str,
        user_message: str,
        prompt_version: str,
        cache_prefix: str | None = None,
    ) -> SegmentedScene:
        """`cache_prefix` is the whole split script, so a per-scene call can
        judge what a beat MEANS against the rest of the episode while still
        deciding boundaries locally. See `render.build_split_source_block`."""
        ...

    def scan_consistency(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> ConsistencyScan: ...

    def generate_scene_skeleton(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> InitialSceneSkeleton: ...

    def prewarm_cache(
        self,
        op: str,
        *,
        system: str,
        user_message: str,
        cache_prefix: str | None = None,
    ) -> None:
        """Best-effort: write the prompt cache for `op` without generating an answer.

        Takes the same `system`/`user_message`/`cache_prefix` the real `op`
        call will send, so the cached prefix matches. Never validates output
        and never raises for a failed request (a cold cache costs money, not
        correctness); an unknown `op` raises `KeyError`."""
        ...
