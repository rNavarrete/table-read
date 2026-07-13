"""`MockLlmClient` -- deterministic, fixture-derived replays of every LLM
operation. Never touches the network (CLAUDE.md hard rule 1); this is the
only `LlmClient` any test may construct.

Keying strategy (see the task report for the full rationale): one canned
response *per operation name*, not per input. No prompt-rendering code exists
yet (`drama_manager/render.py` is a later task), so there is no comparable
"real" prompt text to hash against -- hashing today's placeholder inputs would
be brittle and would silently stop matching once real prompts exist. Each
default is hand-derived from the fixture project ("The Long Pour":
docs/tableread-fixture.json) so later tasks (T2.1+) get deterministic,
fixture-consistent mock output with zero setup. Tests that need a specific
scenario call `set_response(op, value)` to override the default for that op.
"""

from __future__ import annotations

import threading
from collections.abc import Iterator

from pydantic import BaseModel

from llm.ops import OP_REGISTRY
from schemas import (
    BeatCandidate,
    BlastRadius,
    ConsistencyScan,
    InitialSceneSkeleton,
    InstructionSuggestions,
    LedgerExtraction,
    RegeneratedElements,
    SegmentedScene,
)


def _default_responses() -> dict[str, BaseModel]:
    return {
        "generate_beat_candidates": BeatCandidate(
            label="Quiet reveal",
            beatPlan={
                "whatHappens": (
                    "Marta lays the printed transfer record on the counter without "
                    "a word; Dan keeps drying the same glass."
                ),
                "audienceLearns": "Marta has physical proof of the transfer.",
                "audienceFeels": "Tense anticipation.",
            },
            scriptText=(
                "Marta slides a folded printout across the counter.\n\n"
                "DAN\nWhat's this?\n\n"
                "MARTA\nYou tell me.\n\n"
                "Dan doesn't unfold it. He sets down the glass, very carefully."
            ),
            continuityConflicts=[],
        ),
        "tune_beat": BeatCandidate(
            label="Deflected ambush",
            beatPlan={
                "whatHappens": "Marta confronts Dan directly about the transfer; he deflects.",
                "audienceLearns": "Dan will lie rather than admit the transfer.",
                "audienceFeels": "Frustration.",
            },
            scriptText=(
                "MARTA\nI saw the transfer, Dan.\n\nDAN\nI don't know what you're talking about."
            ),
            continuityConflicts=[],
        ),
        # Prompt spec §3 worked example: marina edit of scene-2 → scene-2,
        # cross-scene beat-4-2 (Marta searches the bar), fact-02 (ice machine),
        # and speculative scene-5 (argument still staged around "your bar").
        "classify_blast_radius": BlastRadius(
            impacted=[
                {
                    "objectType": "scene",
                    "objectId": "scene-2",
                    "reason": "Scene premise changes from bar to marina.",
                    "confidence": "high",
                },
                {
                    "objectType": "beat",
                    "objectId": "beat-4-2",
                    "reason": (
                        "Marta searches the bar safe for the money that would no longer be there."
                    ),
                    "confidence": "high",
                },
                {
                    "objectType": "ledgerFact",
                    "objectId": "fact-02",
                    "reason": "Fact states the money is hidden in the bar's ice machine.",
                    "confidence": "high",
                },
                {
                    "objectType": "scene",
                    "objectId": "scene-5",
                    "reason": "The argument still references the bar as the money's hiding place.",
                    "confidence": "speculative",
                },
            ]
        ),
        "regenerate_elements": RegeneratedElements(
            beats=[
                {
                    "beatId": "beat-4-2",
                    "beatPlan": {
                        "whatHappens": (
                            "Marta searches the marina for the money that is no longer in the bar."
                        ),
                        "audienceLearns": "Marta is hunting the cash at the marina.",
                        "audienceFeels": "Dread.",
                    },
                    "scriptText": ("Marta cuts across the dark marina slips, flashlight low."),
                }
            ],
            scenes=[
                {
                    "sceneId": "scene-2",
                    "fields": {
                        "whatHappens": (
                            "Unable to sleep with Marta in the building, Dan moves "
                            "the cash to a marina locker instead of the ice machine."
                        ),
                        "audienceLearns": None,
                        "audienceFeels": None,
                        "location": "EXT. MARINA - NIGHT",
                        "time": None,
                        "socialSituation": None,
                    },
                }
            ],
            continuityConflicts=[],
        ),
        "extract_ledger_facts": LedgerExtraction(
            newFacts=[
                {
                    "fact": "Dan is arrested.",
                    "factType": "event",
                    "sourceSpan": {
                        "episodeId": "ep-1",
                        "sceneId": "scene-3",
                        "beatId": "beat-3-1",
                        "startLine": 1,
                        "endLine": 4,
                    },
                    "sourceText": "Dan doesn't unfold it. He sets down the glass, very carefully.",
                    "knownBy": ["char-marta", "char-dan"],
                    "audienceKnows": True,
                    "confidence": 0.9,
                }
            ],
            contradictions=[],
        ),
        "suggest_instructions": InstructionSuggestions(
            suggestions=[
                "Have Marta reveal she saw the transfer directly.",
                "Let Dan notice the printout before Marta says anything.",
                "Cut the scene short with an interruption from Reyes.",
            ]
        ),
        "segment_scene": SegmentedScene(
            segments=[
                {
                    "kind": "beat",
                    "startLine": 1,
                    "whatHappens": "Marta confronts Dan with the transfer record.",
                    "audienceLearns": "Marta has proof of the transfer.",
                    "audienceFeels": "Tense anticipation.",
                }
            ],
        ),
        # §9.4 guided-setup scene skeleton: one diverse scene-addition set,
        # motivations referencing the fixture's own characters so tests can
        # exercise real character ids without a bespoke override.
        "generate_scene_skeleton": InitialSceneSkeleton(
            label="Cold open on the wire transfer",
            scenes=[
                {
                    "act": 1,
                    "location": "INT. THE LONG POUR - MORNING",
                    "time": "MORNING",
                    "socialSituation": "Marta corners Dan before the bar opens.",
                    "whatHappens": (
                        "Marta demands Dan explain the wire transfer before "
                        "the morning delivery arrives."
                    ),
                    "audienceLearns": "Marta has already seen the paperwork.",
                    "audienceFeels": "Coiled tension.",
                    "motivations": [
                        {
                            "characterId": "char-marta",
                            "objective": "Get Dan to admit the transfer.",
                            "stakes": "The bar's survival.",
                            "obstacle": "Dan's practiced calm.",
                        }
                    ],
                    "beatPlanSeeds": [
                        {
                            "whatHappens": "Marta slides the printout across the bar.",
                            "audienceLearns": "The transfer amount.",
                            "audienceFeels": "Dread.",
                        }
                    ],
                },
                {
                    "act": 1,
                    "location": "EXT. MARINA - DAY",
                    "time": "DAY",
                    "socialSituation": "Dan meets Reyes at the marina to explain himself.",
                    "whatHappens": "Dan tries to buy time from Reyes.",
                    "audienceLearns": "Reyes is owed the money, not a bank.",
                    "audienceFeels": "Rising dread.",
                    "motivations": [
                        {
                            "characterId": "char-dan",
                            "objective": "Delay Reyes without confessing.",
                            "stakes": "His own safety.",
                            "obstacle": "Reyes's patience is gone.",
                        }
                    ],
                    "beatPlanSeeds": [
                        {
                            "whatHappens": "Dan offers a partial payment.",
                            "audienceLearns": "Dan doesn't have the full amount.",
                            "audienceFeels": "Anxiety.",
                        }
                    ],
                },
            ],
        ),
        "scan_consistency": ConsistencyScan(
            flags=[
                {
                    "objectType": "scene",
                    "objectId": "scene-5",
                    "factId": None,
                    "explanation": (
                        "The argument's stakes reference the bar as the money's "
                        "hiding place, which is no longer true."
                    ),
                    "severity": "tension",
                }
            ]
        ),
    }


class MockLlmClient:
    """See module docstring for the keying strategy."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._responses: dict[str, BaseModel] = _default_responses()
        # Per-op FIFO queues for multi-call scenarios (e.g. import calls
        # segment_scene / extract_ledger_facts once per scene): each call pops
        # the next queued response, falling back to the single default when the
        # queue is empty. Left empty, the mock behaves exactly as before.
        self._queues: dict[str, list[BaseModel]] = {}
        # Per-call raw-fragment streams for stream_beat_candidate (§8a harness):
        # each entry is the exact list of raw tool-input JSON fragments one
        # streamed call should yield, so tests can force mid-escape splits,
        # out-of-order fields, or missing scriptText. Empty → the streaming
        # method serializes the normal generate_beat_candidates response.
        self._candidate_streams: list[list[str]] = []
        # Same mechanism for stream_tune_beat (§8a: tune streams too). Empty →
        # the streamed value is derived from the tune_beat op response.
        self._tune_streams: list[list[str]] = []
        # Per-op invocation counters (T4.2: apply must record zero
        # `regenerate_elements` calls — the stored preview is applied verbatim).
        self._invocations: dict[str, int] = {name: 0 for name in OP_REGISTRY}
        assert self._responses.keys() == OP_REGISTRY.keys(), (
            "MockLlmClient default responses must cover every op in OP_REGISTRY"
        )

    def invocation_count(self, op: str) -> int:
        if op not in OP_REGISTRY:
            raise KeyError(f"unknown LLM operation {op!r}")
        with self._lock:
            return self._invocations[op]

    def total_invocations(self) -> int:
        with self._lock:
            return sum(self._invocations.values())

    def reset_invocation_counts(self) -> None:
        with self._lock:
            for name in self._invocations:
                self._invocations[name] = 0

    def set_response(self, op: str, response: BaseModel) -> None:
        if op not in OP_REGISTRY:
            raise KeyError(f"unknown LLM operation {op!r}")
        with self._lock:
            self._responses[op] = response

    def set_responses(self, op: str, responses: list[BaseModel]) -> None:
        """Queue a sequence of responses for ``op``, returned one per call in
        order (then falling back to the default). For pipelines that call the
        same op multiple times with different inputs."""
        if op not in OP_REGISTRY:
            raise KeyError(f"unknown LLM operation {op!r}")
        with self._lock:
            self._queues[op] = list(responses)

    def _call(self, op: str, *, system: str, user_message: str, prompt_version: str) -> BaseModel:
        del system, user_message, prompt_version  # mock never inspects prompt content
        with self._lock:
            self._invocations[op] = self._invocations.get(op, 0) + 1
            queue = self._queues.get(op)
            if queue:
                return queue.pop(0)
            return self._responses[op]

    def set_candidate_streams(self, streams: list[list[str]]) -> None:
        """Queue raw-fragment streams for `stream_beat_candidate`, one list of
        fragments per streamed call, returned in order. For §8a streaming-
        contract tests (mid-escape splits, late/absent scriptText). When unset,
        the streamed value is derived from the normal generate_beat_candidates
        response (default or `set_responses` queue)."""
        self._candidate_streams = [list(frags) for frags in streams]

    def set_tune_streams(self, streams: list[list[str]]) -> None:
        """Queue raw-fragment streams for `stream_tune_beat`, one list of
        fragments per streamed call (the tune analogue of `set_candidate_streams`).
        When unset, the streamed value is derived from the `tune_beat` op response."""
        self._tune_streams = [list(frags) for frags in streams]

    def generate_beat_candidates(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> BeatCandidate:
        return self._call(
            "generate_beat_candidates",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )

    def stream_beat_candidate(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> Iterator[str]:
        if self._candidate_streams:
            yield from self._candidate_streams.pop(0)
            return
        candidate = self._call(
            "generate_beat_candidates",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )
        # Serialize the canned candidate to its camelCase wire JSON as a single
        # fragment; the caller's incremental parser handles it identically to a
        # multi-fragment stream. Distinct `set_responses` entries → distinct
        # streamed cards (diversity).
        yield candidate.model_dump_json(by_alias=True)

    def tune_beat(self, *, system: str, user_message: str, prompt_version: str) -> BeatCandidate:
        return self._call(
            "tune_beat", system=system, user_message=user_message, prompt_version=prompt_version
        )

    def stream_tune_beat(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> Iterator[str]:
        if self._tune_streams:
            yield from self._tune_streams.pop(0)
            return
        candidate = self._call(
            "tune_beat", system=system, user_message=user_message, prompt_version=prompt_version
        )
        # Serialize the canned tune result to camelCase wire JSON as one fragment;
        # the caller's incremental parser handles it identically to a multi-fragment
        # stream. `set_responses("tune_beat", [...])` → distinct streamed cards.
        yield candidate.model_dump_json(by_alias=True)

    def classify_blast_radius(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> BlastRadius:
        return self._call(
            "classify_blast_radius",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )

    def regenerate_elements(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> RegeneratedElements:
        return self._call(
            "regenerate_elements",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )

    def extract_ledger_facts(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> LedgerExtraction:
        return self._call(
            "extract_ledger_facts",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )

    def suggest_instructions(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> InstructionSuggestions:
        return self._call(
            "suggest_instructions",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )

    def segment_scene(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> SegmentedScene:
        return self._call(
            "segment_scene", system=system, user_message=user_message, prompt_version=prompt_version
        )

    def scan_consistency(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> ConsistencyScan:
        return self._call(
            "scan_consistency",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )

    def generate_scene_skeleton(
        self, *, system: str, user_message: str, prompt_version: str
    ) -> InitialSceneSkeleton:
        return self._call(
            "generate_scene_skeleton",
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
        )
