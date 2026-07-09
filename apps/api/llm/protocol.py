"""`LlmClient` -- the 8-operation Protocol both `MockLlmClient` and
`AnthropicClient` structurally satisfy (data contract §2a + §2's
`BeatCandidate`; see `llm/ops.py`'s module docstring for the "7 ops" naming
reconciliation).

Every method takes an already-rendered `system`/`user_message` pair rather
than a domain "context bundle" -- see `llm/__init__.py` for why prompt
construction stays out of this layer.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from schemas import (
    BeatCandidate,
    BlastRadius,
    ConsistencyScan,
    InstructionSuggestions,
    LedgerExtraction,
    RegeneratedElements,
    SegmentedScene,
)


@runtime_checkable
class LlmClient(Protocol):
    def generate_beat_candidates(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> BeatCandidate: ...

    def tune_beat(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> BeatCandidate: ...

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

    def segment_scene(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> SegmentedScene: ...

    def scan_consistency(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> ConsistencyScan: ...
