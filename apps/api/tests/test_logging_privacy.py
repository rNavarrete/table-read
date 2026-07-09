"""T6.3: no writer text in logs — IDs, hashes, PROMPT_VERSION, token counts only.

Hard rule 5 / prompt spec §8 privacy: mutating and LLM paths must never log
script, plan, instruction, or other freeform writer content. Caplog across
representative routes and assert distinctive fixture / mock substrings are
absent while project ids and op metadata may appear.
"""

from __future__ import annotations

import logging

import pytest
from fastapi.testclient import TestClient

from drama_manager import render
from llm.dependency import get_llm_client
from llm.mock import MockLlmClient
from main import app
from schemas import ConsistencyScan, LedgerExtraction

client = TestClient(app)

PROJECT_ID = "proj-longpour"

# Distinctive writer substrings that must never appear in log messages.
# Drawn from the fixture ("The Long Pour"), mock LLM script text, and the
# marina Change Set instruction used across the suite.
WRITER_SUBSTRINGS = (
    "I saw the transfer",
    "Dan hides the money at the marina",
    "Marta searches the marina",
    "Reyes snaps the cuffs",
    "The Long Pour",
    "ice machine",
    "Harbor Street",
)

MARINA_INSTRUCTION = "Dan hides the money at the marina instead of the bar"

ACCEPT_SCRIPT = (
    "INT. THE LONG POUR - DAY\n\nReyes snaps the cuffs on Dan.\n\nDAN\nThis is a mistake."
)


@pytest.fixture()
def mock_llm():
    llm = MockLlmClient()
    llm.set_response(
        "extract_ledger_facts",
        LedgerExtraction.model_validate({"newFacts": [], "contradictions": []}),
    )
    llm.set_response(
        "scan_consistency",
        ConsistencyScan.model_validate({"flags": []}),
    )
    app.dependency_overrides[get_llm_client] = lambda: llm
    yield llm
    app.dependency_overrides.pop(get_llm_client, None)


def _joined_logs(caplog) -> str:
    return " ".join(r.getMessage() for r in caplog.records)


def _assert_no_writer_text(joined: str) -> None:
    for needle in WRITER_SUBSTRINGS:
        assert needle not in joined, f"writer text leaked into logs: {needle!r}"


def test_accept_beat_logs_ids_not_script(seeded_project, mock_llm, caplog):
    with caplog.at_level(logging.INFO):
        resp = client.post(
            f"/api/v1/projects/{PROJECT_ID}/scenes/scene-3/beats",
            json={
                "candidate": {
                    "label": "The arrest",
                    "beatPlan": {
                        "whatHappens": "Reyes arrests Dan.",
                        "audienceLearns": "Dan is caught.",
                        "audienceFeels": "Shock.",
                    },
                    "scriptText": ACCEPT_SCRIPT,
                    "continuityConflicts": [],
                },
                "afterBeatId": "beat-3-1",
            },
        )
    assert resp.status_code == 200

    joined = _joined_logs(caplog)
    _assert_no_writer_text(joined)
    assert PROJECT_ID in joined
    assert render.PROMPT_VERSION in joined


def test_change_set_create_logs_ids_not_instruction(seeded_project, mock_llm, caplog):
    with caplog.at_level(logging.INFO):
        resp = client.post(
            f"/api/v1/projects/{PROJECT_ID}/change-sets",
            json={"targetObjectId": "scene-2", "instruction": MARINA_INSTRUCTION},
        )
    assert resp.status_code == 200

    joined = _joined_logs(caplog)
    _assert_no_writer_text(joined)
    assert PROJECT_ID in joined
    assert render.PROMPT_VERSION in joined
    # Change-set id is minted server-side and logged — not the instruction.
    assert resp.json()["id"] in joined


def test_anthropic_client_log_hashes_user_message_never_content(caplog):
    """Direct AnthropicClient._log path: input_hash present, message absent."""
    import hashlib
    from dataclasses import dataclass, field
    from typing import Any

    from llm.anthropic_client import AnthropicClient

    @dataclass
    class _FakeToolUse:
        input: dict[str, Any]
        name: str = "generate_beat_candidates"
        id: str = "toolu_1"
        type: str = "tool_use"

    @dataclass
    class _FakeUsage:
        input_tokens: int = 100
        output_tokens: int = 50

    @dataclass
    class _FakeMessage:
        content: list[Any] = field(default_factory=list)
        usage: _FakeUsage = field(default_factory=_FakeUsage)
        stop_reason: str = "tool_use"

    class _FakeMessages:
        def __init__(self, responses: list[_FakeMessage]) -> None:
            self._responses = list(responses)

        def create(self, **_kwargs: Any) -> _FakeMessage:
            return self._responses.pop(0)

    class _FakeSdk:
        def __init__(self, responses: list[_FakeMessage]) -> None:
            self.messages = _FakeMessages(responses)

    secret = "WRITER INSTRUCTION: Marta confesses she embezzled the money"
    expected_hash = hashlib.sha256(secret.encode()).hexdigest()[:16]
    valid_input = {
        "label": "Quiet reveal",
        "beatPlan": {
            "whatHappens": "x",
            "audienceLearns": "y",
            "audienceFeels": "z",
        },
        "scriptText": "MARTA\nYou tell me.",
        "continuityConflicts": [],
    }
    sdk = _FakeSdk([_FakeMessage(content=[_FakeToolUse(input=valid_input)])])
    client_llm = AnthropicClient(
        sdk_client=sdk,
        models={"writer": "writer-model-x", "classifier": "classifier-model-y"},
    )

    with caplog.at_level(logging.INFO, logger="llm.anthropic_client"):
        client_llm.generate_beat_candidates(
            system="top secret system prompt",
            user_message=secret,
            prompt_version="7.2.1",
        )

    assert len(caplog.records) == 1
    message = caplog.records[0].getMessage()
    assert f"input_hash={expected_hash}" in message
    assert secret not in message
    assert "Marta" not in message
    assert "embezzled" not in message
    assert "generate_beat_candidates" in message
    assert "7.2.1" in message
