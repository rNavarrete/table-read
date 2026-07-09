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

from collections.abc import Iterator

from pydantic import BaseModel

from llm.ops import OP_REGISTRY
from schemas import (
    BeatCandidate,
    BlastRadius,
    ConsistencyScan,
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
                "MARTA\nI saw the transfer, Dan.\n\n"
                "DAN\nI don't know what you're talking about."
            ),
            continuityConflicts=[],
        ),
        "classify_blast_radius": BlastRadius(
            impacted=[
                {
                    "objectType": "scene",
                    "objectId": "scene-2",
                    "reason": "Scene premise changes from bar to marina.",
                    "confidence": "high",
                },
                {
                    "objectType": "ledgerFact",
                    "objectId": "fact-02",
                    "reason": "Fact states the money is hidden in the bar's ice machine.",
                    "confidence": "high",
                },
            ]
        ),
        "regenerate_elements": RegeneratedElements(
            beats=[
                {
                    "beatId": "beat-3-1",
                    "beatPlan": {
                        "whatHappens": (
                            "Marta lays the printed transfer record on the counter "
                            "without a word."
                        ),
                        "audienceLearns": "Marta has proof.",
                        "audienceFeels": "Tense anticipation.",
                    },
                    "scriptText": "Marta slides a folded printout across the counter.",
                }
            ],
            scenes=[],
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
            beats=[
                {
                    "startLine": 1,
                    "endLine": 6,
                    "whatHappens": "Marta confronts Dan with the transfer record.",
                    "audienceLearns": "Marta has proof of the transfer.",
                    "audienceFeels": "Tense anticipation.",
                }
            ],
            unassigned=[],
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
        assert self._responses.keys() == OP_REGISTRY.keys(), (
            "MockLlmClient default responses must cover every op in OP_REGISTRY"
        )

    def set_response(self, op: str, response: BaseModel) -> None:
        if op not in OP_REGISTRY:
            raise KeyError(f"unknown LLM operation {op!r}")
        self._responses[op] = response

    def set_responses(self, op: str, responses: list[BaseModel]) -> None:
        """Queue a sequence of responses for ``op``, returned one per call in
        order (then falling back to the default). For pipelines that call the
        same op multiple times with different inputs."""
        if op not in OP_REGISTRY:
            raise KeyError(f"unknown LLM operation {op!r}")
        self._queues[op] = list(responses)

    def _call(self, op: str, *, system: str, user_message: str, prompt_version: str) -> BaseModel:
        del system, user_message, prompt_version  # mock never inspects prompt content
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
