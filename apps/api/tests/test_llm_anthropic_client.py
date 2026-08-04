"""AnthropicClient: tool-forcing, retry-once-then-surface (CLAUDE.md hard
rule 9), role-based model/temperature selection, and PROMPT_VERSION/token
logging. `sdk_client` is always a hand-built fake -- never `anthropic.
Anthropic()` -- so nothing here can reach the network (hard rule 1); see
test_llm_factory.py for the explicit socket-level proof.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import pytest

from llm.anthropic_client import AnthropicClient
from llm.errors import SchemaInvalidLlmError
from llm.ops import OP_REGISTRY

_MODELS = {
    "writer": "writer-model-x",
    "classifier": "classifier-model-y",
    "import_worker": "import-worker-model-w",
    "import_analyst": "import-analyst-model-z",
}


@dataclass
class FakeToolUseBlock:
    input: dict[str, Any]
    name: str = "generate_beat_candidates"
    id: str = "toolu_1"
    type: str = "tool_use"


@dataclass
class FakeUsage:
    input_tokens: int = 100
    output_tokens: int = 50


@dataclass
class FakeMessage:
    content: list[Any] = field(default_factory=list)
    usage: FakeUsage = field(default_factory=FakeUsage)
    stop_reason: str = "tool_use"


class FakeMessagesEndpoint:
    """Stands in for `anthropic.Anthropic().messages`. `responses` is a
    queue of FakeMessage returned in order, one per `.create()` call; the
    test asserts on `self.calls` (the raw kwargs each call received)."""

    def __init__(self, responses: list[FakeMessage]) -> None:
        self._responses = list(responses)
        self.calls: list[dict[str, Any]] = []

    def create(self, **kwargs: Any) -> FakeMessage:
        self.calls.append(kwargs)
        return self._responses.pop(0)


class FakeSdkClient:
    def __init__(self, responses: list[FakeMessage]) -> None:
        self.messages = FakeMessagesEndpoint(responses)


class FakeMessageStream:
    def __init__(self, response: FakeMessage) -> None:
        self.response = response
        self.closed = False

    def __enter__(self) -> FakeMessageStream:
        return self

    def __exit__(self, *args: Any) -> None:
        self.closed = True

    def get_final_message(self) -> FakeMessage:
        return self.response

    def close(self) -> None:
        self.closed = True


class FakeStreamingMessagesEndpoint(FakeMessagesEndpoint):
    def __init__(self, responses: list[FakeMessage]) -> None:
        super().__init__(responses)
        self.stream_calls: list[dict[str, Any]] = []

    def stream(self, **kwargs: Any) -> FakeMessageStream:
        self.stream_calls.append(kwargs)
        return FakeMessageStream(self._responses.pop(0))


class FakeStreamingSdkClient:
    def __init__(self, responses: list[FakeMessage]) -> None:
        self.messages = FakeStreamingMessagesEndpoint(responses)


_VALID_BEAT_CANDIDATE_INPUT = {
    "label": "Quiet reveal",
    "beatPlan": {
        "whatHappens": "x",
        "audienceLearns": "y",
        "audienceFeels": "z",
    },
    "scriptText": "MARTA\nYou tell me.",
    "continuityConflicts": [],
}


def _valid_response() -> FakeMessage:
    return FakeMessage(content=[FakeToolUseBlock(input=_VALID_BEAT_CANDIDATE_INPUT)])


def _invalid_response(tool_use_id: str = "toolu_1") -> FakeMessage:
    # Missing every required field -> Pydantic ValidationError.
    return FakeMessage(content=[FakeToolUseBlock(input={}, id=tool_use_id)])


# ---------------------------------------------------------------------------
# Retry path (CLAUDE.md hard rule 9 / task brief accept criterion: "retry
# path unit-tested (first response invalid -> second valid)").
# ---------------------------------------------------------------------------


def test_first_invalid_then_valid_succeeds_after_exactly_one_retry():
    sdk = FakeSdkClient([_invalid_response(), _valid_response()])
    client = AnthropicClient(sdk_client=sdk, models=_MODELS)

    result = client.generate_beat_candidates(
        system="sys", user_message="hi", prompt_version="0.1.0"
    )

    assert result.label == "Quiet reveal"
    assert len(sdk.messages.calls) == 2  # exactly one retry, not more


def test_retry_call_appends_the_validation_error_as_an_is_error_tool_result():
    sdk = FakeSdkClient([_invalid_response(tool_use_id="toolu_abc"), _valid_response()])
    client = AnthropicClient(sdk_client=sdk, models=_MODELS)

    client.generate_beat_candidates(system="sys", user_message="hi", prompt_version="0.1.0")

    retry_messages = sdk.messages.calls[1]["messages"]
    # original user turn, then the failed assistant tool_use, then our
    # appended tool_result carrying the validation error.
    assert retry_messages[0]["role"] == "user"
    assert retry_messages[1]["role"] == "assistant"
    error_turn = retry_messages[2]
    assert error_turn["role"] == "user"
    tool_result = error_turn["content"][0]
    assert tool_result["type"] == "tool_result"
    assert tool_result["tool_use_id"] == "toolu_abc"
    assert tool_result["is_error"] is True
    assert tool_result["content"]  # the validation error text is present, non-empty


def test_second_invalid_response_raises_schema_invalid_llm_and_stops():
    sdk = FakeSdkClient([_invalid_response(), _invalid_response()])
    client = AnthropicClient(sdk_client=sdk, models=_MODELS)

    with pytest.raises(SchemaInvalidLlmError) as exc_info:
        client.generate_beat_candidates(system="sys", user_message="hi", prompt_version="0.1.0")

    assert exc_info.value.code == "SCHEMA_INVALID_LLM"
    assert exc_info.value.op == "generate_beat_candidates"
    assert len(sdk.messages.calls) == 2  # never a third attempt -- no fabricated fallback


def _assert_tool_result_wire_invariant(messages: list[dict[str, Any]]) -> None:
    """For every tool_use id in message n, message n+1 must be role=user and
    its content must START with a tool_result for that id (real API 400s
    otherwise -- "tool_use ids were found without tool_result blocks
    immediately after")."""
    for i, message in enumerate(messages[:-1]):
        content = message["content"]
        if isinstance(content, str):
            continue
        tool_use_ids = [
            block["id"] if isinstance(block, dict) else block.id
            for block in content
            if (block.get("type") if isinstance(block, dict) else getattr(block, "type", None))
            == "tool_use"
        ]
        if not tool_use_ids:
            continue
        nxt = messages[i + 1]
        assert nxt["role"] == "user"
        leading_tool_results = nxt["content"][: len(tool_use_ids)]
        assert [b["type"] for b in leading_tool_results] == ["tool_result"] * len(tool_use_ids)
        assert {b["tool_use_id"] for b in leading_tool_results} == set(tool_use_ids)


def test_retry_call_satisfies_tool_result_wire_invariant_for_a_single_tool_use():
    sdk = FakeSdkClient([_invalid_response(tool_use_id="toolu_abc"), _valid_response()])
    client = AnthropicClient(sdk_client=sdk, models=_MODELS)

    client.generate_beat_candidates(system="sys", user_message="hi", prompt_version="0.1.0")

    _assert_tool_result_wire_invariant(sdk.messages.calls[1]["messages"])


def test_retry_call_satisfies_tool_result_wire_invariant_for_multiple_tool_use_blocks():
    # Tool-forcing doesn't rule out parallel tool use: the first response can
    # contain more than one tool_use block for the forced tool. Every id must
    # get its own tool_result in the retry turn, not just the one that failed
    # validation.
    first = FakeMessage(
        content=[
            FakeToolUseBlock(input={}, id="toolu_1"),  # fails validation
            FakeToolUseBlock(input={}, id="toolu_2"),  # duplicate/parallel call
        ]
    )
    sdk = FakeSdkClient([first, _valid_response()])
    client = AnthropicClient(sdk_client=sdk, models=_MODELS)

    client.generate_beat_candidates(system="sys", user_message="hi", prompt_version="0.1.0")

    retry_messages = sdk.messages.calls[1]["messages"]
    _assert_tool_result_wire_invariant(retry_messages)

    tool_result_turn = retry_messages[2]
    results = {r["tool_use_id"]: r for r in tool_result_turn["content"]}
    assert set(results) == {"toolu_1", "toolu_2"}
    assert all(r["is_error"] is True for r in results.values())
    assert results["toolu_1"]["content"]  # the validation error text
    assert "toolu_2" not in results["toolu_1"]["content"]
    assert results["toolu_2"]["content"] != results["toolu_1"]["content"]


def test_missing_tool_use_block_is_treated_as_recoverable_and_retried():
    # Model ignored the forced tool_choice entirely on the first attempt.
    sdk = FakeSdkClient([FakeMessage(content=[], stop_reason="end_turn"), _valid_response()])
    client = AnthropicClient(sdk_client=sdk, models=_MODELS)

    result = client.generate_beat_candidates(
        system="sys", user_message="hi", prompt_version="0.1.0"
    )

    assert result.label == "Quiet reveal"
    assert len(sdk.messages.calls) == 2
    # No tool_use_id was available, so the retry falls back to a plain text turn.
    retry_messages = sdk.messages.calls[1]["messages"]
    assert retry_messages[-1]["role"] == "user"
    assert isinstance(retry_messages[-1]["content"], str)
    _assert_tool_result_wire_invariant(retry_messages)  # no tool_use blocks -> vacuously fine


def test_valid_first_response_never_retries():
    sdk = FakeSdkClient([_valid_response()])
    client = AnthropicClient(sdk_client=sdk, models=_MODELS)

    client.generate_beat_candidates(system="sys", user_message="hi", prompt_version="0.1.0")

    assert len(sdk.messages.calls) == 1


# ---------------------------------------------------------------------------
# Tool-forcing mechanics (prompt spec header: tool_choice + strict: true).
# ---------------------------------------------------------------------------


def test_call_forces_the_named_tool_with_strict_schema():
    sdk = FakeSdkClient([_valid_response()])
    client = AnthropicClient(sdk_client=sdk, models=_MODELS)

    client.generate_beat_candidates(system="sys", user_message="hi", prompt_version="0.1.0")

    call = sdk.messages.calls[0]
    assert call["tool_choice"] == {"type": "tool", "name": "generate_beat_candidates"}
    assert len(call["tools"]) == 1
    tool = call["tools"][0]
    assert tool["name"] == "generate_beat_candidates"
    assert tool["strict"] is True
    assert tool["input_schema"]["additionalProperties"] is False
    assert tool["input_schema"]["required"] == [
        "label",
        "beatPlan",
        "scriptText",
        "continuityConflicts",
    ]


# ---------------------------------------------------------------------------
# Role-based model + temperature selection (prompt spec §8 role assignments;
# §3/§5/§6/§8c "Temperature 0" on classifier ops).
# ---------------------------------------------------------------------------


def test_writer_role_op_uses_the_writer_model_and_no_temperature():
    sdk = FakeSdkClient([_valid_response()])
    client = AnthropicClient(sdk_client=sdk, models=_MODELS)

    client.generate_beat_candidates(system="sys", user_message="hi", prompt_version="0.1.0")

    call = sdk.messages.calls[0]
    assert call["model"] == "writer-model-x"
    assert "temperature" not in call


def test_narrative_map_uses_writer_model_and_no_temperature():
    valid_map = FakeMessage(
        content=[
            FakeToolUseBlock(
                input=_fixture_valid_input_for("infer_narrative_map"),
                name="infer_narrative_map",
            )
        ]
    )
    sdk = FakeSdkClient([valid_map])
    client = AnthropicClient(sdk_client=sdk, models=_MODELS)

    client.infer_narrative_map(system="sys", user_message="hi", prompt_version="0.1.0")

    call = sdk.messages.calls[0]
    assert call["model"] == "writer-model-x"
    assert "temperature" not in call


def test_import_analyst_role_op_uses_import_analyst_model_and_no_temperature():
    """Import story-breakdown ops omit temperature (Opus 5 rejects non-defaults)."""
    from schemas import InferredStoryOverview

    valid_overview = FakeMessage(
        content=[
            FakeToolUseBlock(
                input=_fixture_valid_input_for("infer_story_overview"),
                name="infer_story_overview",
            )
        ]
    )
    sdk = FakeSdkClient([valid_overview])
    client = AnthropicClient(sdk_client=sdk, models=_MODELS)

    result = client.infer_story_overview(system="sys", user_message="hi", prompt_version="0.1.0")

    assert isinstance(result, InferredStoryOverview)
    call = sdk.messages.calls[0]
    assert call["model"] == "import-analyst-model-z"
    assert "temperature" not in call


def test_import_worker_role_op_uses_import_worker_model_and_no_temperature():
    valid_segment = FakeMessage(
        content=[
            FakeToolUseBlock(
                input=_fixture_valid_input_for("segment_scene"),
                name="segment_scene",
            )
        ]
    )
    sdk = FakeSdkClient([valid_segment])
    client = AnthropicClient(sdk_client=sdk, models=_MODELS)

    client.segment_scene(system="sys", user_message="hi", prompt_version="0.1.0")

    call = sdk.messages.calls[0]
    assert call["model"] == "import-worker-model-w"
    assert "temperature" not in call


def test_narrative_scene_analysis_forces_a_strict_tool_with_adaptive_thinking():
    valid_analysis = FakeMessage(
        content=[
            FakeToolUseBlock(
                input=_fixture_valid_input_for("infer_narrative_scene_analysis"),
                name="infer_narrative_scene_analysis",
            )
        ]
    )
    sdk = FakeSdkClient([valid_analysis])
    client = AnthropicClient(sdk_client=sdk, models=_MODELS)

    client.infer_narrative_scene_analysis(
        system="sys",
        user_message="analyze the supplied scene",
        prompt_version="0.26.0",
    )

    call = sdk.messages.calls[0]
    assert call["model"] == "import-analyst-model-z"
    # Forced + adaptive thinking is a supported pairing: the "auto only"
    # restriction applies to manual extended thinking (budget_tokens), which
    # this client never sends. Forcing guarantees the structured response.
    assert call["tool_choice"] == {
        "type": "tool",
        "name": "infer_narrative_scene_analysis",
    }
    assert call["thinking"] == {"type": "adaptive"}
    assert call["output_config"] == {"effort": "medium"}
    assert call["tools"][0]["strict"] is True
    assert "temperature" not in call


def test_narrative_map_synthesis_forces_a_strict_tool_with_adaptive_thinking():
    op_name = "infer_narrative_map_synthesis"
    response = FakeMessage(
        content=[
            FakeToolUseBlock(
                input=_fixture_valid_input_for(op_name),
                name=op_name,
            )
        ]
    )
    sdk = FakeStreamingSdkClient([response])
    client = AnthropicClient(sdk_client=sdk, models=_MODELS)

    result = getattr(client, op_name)(
        system="sys",
        user_message="analyze the saved scene packets",
        prompt_version="0.26.0",
    )

    assert result is not None
    assert sdk.messages.calls == []
    assert len(sdk.messages.stream_calls) == 1
    call = sdk.messages.stream_calls[0]
    assert call["tool_choice"] == {"type": "tool", "name": op_name}
    # Never {"type": "disabled"}: with thinking off, Claude Opus 5 can emit the
    # tool call as plain text — the turn succeeds, the call never runs, and
    # this op fails closed (retry_schema_once=False).
    assert call["thinking"] == {"type": "adaptive"}
    assert call["output_config"] == {"effort": "medium"}
    assert call["tools"][0]["strict"] is True
    assert "stream" not in call
    assert OP_REGISTRY[op_name].call_timeout_seconds == 600.0
    assert OP_REGISTRY[op_name].retry_schema_once is False
    # Thinking counts toward max_tokens, so the ceiling covers both.
    assert OP_REGISTRY[op_name].max_tokens == 24_576


def test_narrative_map_verifier_streams_one_forced_strict_tool_call():
    op_name = "verify_narrative_map"
    response = FakeMessage(
        content=[
            FakeToolUseBlock(
                input=_fixture_valid_input_for(op_name),
                name=op_name,
            )
        ]
    )
    sdk = FakeStreamingSdkClient([response])
    client = AnthropicClient(sdk_client=sdk, models=_MODELS)

    result = client.verify_narrative_map(
        system="sys",
        user_message="verify the saved candidate",
        prompt_version="0.28.0",
    )

    assert result.approved is True
    assert sdk.messages.calls == []
    assert len(sdk.messages.stream_calls) == 1
    call = sdk.messages.stream_calls[0]
    assert call["tool_choice"] == {
        "type": "tool",
        "name": "verify_narrative_map",
    }
    assert call["thinking"] == {"type": "adaptive"}
    assert call["output_config"] == {"effort": "low"}
    assert call["tools"][0]["strict"] is True
    assert "stream" not in call
    assert OP_REGISTRY[op_name].call_timeout_seconds == 300.0
    assert OP_REGISTRY[op_name].max_tokens == 8_192
    assert OP_REGISTRY[op_name].retry_schema_once is False


def test_narrative_map_verifier_does_not_repeat_a_malformed_response():
    sdk = FakeStreamingSdkClient(
        [
            FakeMessage(
                content=[
                    FakeToolUseBlock(
                        input={},
                        name="verify_narrative_map",
                    )
                ]
            )
        ]
    )
    client = AnthropicClient(sdk_client=sdk, models=_MODELS)

    with pytest.raises(SchemaInvalidLlmError) as exc_info:
        client.verify_narrative_map(
            system="sys",
            user_message="verify the saved candidate",
            prompt_version="0.28.0",
        )

    assert exc_info.value.op == "verify_narrative_map"
    assert sdk.messages.calls == []
    assert len(sdk.messages.stream_calls) == 1


def test_classifier_role_op_uses_the_classifier_model_and_temperature_zero():
    from schemas import BlastRadius

    valid_blast_radius = FakeMessage(
        content=[
            FakeToolUseBlock(
                input={"impacted": []},
                name="classify_blast_radius",
            )
        ]
    )
    sdk = FakeSdkClient([valid_blast_radius])
    client = AnthropicClient(sdk_client=sdk, models=_MODELS)

    result = client.classify_blast_radius(system="sys", user_message="hi", prompt_version="0.1.0")

    assert isinstance(result, BlastRadius)
    call = sdk.messages.calls[0]
    assert call["model"] == "classifier-model-y"
    assert call["temperature"] == 0


# ---------------------------------------------------------------------------
# Logging: op, PROMPT_VERSION, model, token counts, retry/failure flags --
# never prompt/response content (CLAUDE.md hard rule 5).
# ---------------------------------------------------------------------------


def test_log_line_carries_metadata_but_never_prompt_or_response_text(caplog):
    sdk = FakeSdkClient([_valid_response()])
    client = AnthropicClient(sdk_client=sdk, models=_MODELS)

    secret_user_message = "WRITER INSTRUCTION: Marta confesses she embezzled the money"
    with caplog.at_level(logging.INFO, logger="llm.anthropic_client"):
        client.generate_beat_candidates(
            system="top secret system prompt",
            user_message=secret_user_message,
            prompt_version="7.2.1",
        )

    assert len(caplog.records) == 1
    message = caplog.records[0].getMessage()
    assert "generate_beat_candidates" in message
    assert "7.2.1" in message
    assert "writer-model-x" in message
    assert "100" in message  # input_tokens
    assert "50" in message  # output_tokens
    assert "stop_reason=tool_use" in message
    assert "content_types=tool_use" in message
    assert "request_id=" in message
    assert "input_hash=" in message
    assert secret_user_message not in message
    assert "top secret system prompt" not in message
    assert "Marta" not in message


def test_all_ops_are_callable_against_the_fake_sdk():
    """Mirrors the mock-client coverage test but against AnthropicClient's
    own dispatch, using op-appropriate fake tool_use blocks."""
    from llm.ops import OP_REGISTRY

    for name, op in OP_REGISTRY.items():
        fake_input = _fixture_valid_input_for(name)
        response = FakeMessage(content=[FakeToolUseBlock(input=fake_input, name=name)])
        sdk = (
            FakeStreamingSdkClient([response]) if op.stream_response else FakeSdkClient([response])
        )
        client = AnthropicClient(sdk_client=sdk, models=_MODELS)

        result = getattr(client, name)(system="sys", user_message="hi", prompt_version="0.1.0")

        assert isinstance(result, op.model)


# ---------------------------------------------------------------------------
# Streaming path (prompt spec §8a). The fake sdk yields raw streaming events;
# the client forwards `input_json_delta` fragments and never touches the
# network (hard rule 1).
# ---------------------------------------------------------------------------


@dataclass
class FakeInputJsonDelta:
    partial_json: str
    type: str = "input_json_delta"


@dataclass
class FakeToolUseContentBlock:
    name: str = "generate_beat_candidates"
    type: str = "tool_use"
    id: str = "toolu_stream"


@dataclass
class FakeContentBlockStart:
    content_block: FakeToolUseContentBlock
    index: int = 0
    type: str = "content_block_start"


@dataclass
class FakeContentBlockDelta:
    delta: FakeInputJsonDelta
    index: int = 0
    type: str = "content_block_delta"


@dataclass
class FakeMessageStart:
    message: FakeMessage
    type: str = "message_start"


@dataclass
class FakeMessageDelta:
    usage: FakeUsage
    type: str = "message_delta"


class FakeStream:
    """Stands in for the SDK's Stream object: iterable + close() (which the
    real SDK uses to cancel the in-flight HTTP request)."""

    def __init__(self, events: list[Any]) -> None:
        self._events = iter(events)
        self.closed = False

    def __iter__(self):
        return self

    def __next__(self):
        return next(self._events)

    def close(self) -> None:
        self.closed = True


class FakeStreamingEndpoint:
    def __init__(self, events: list[Any]) -> None:
        self._events = events
        self.calls: list[dict[str, Any]] = []
        self.last_stream: FakeStream | None = None

    def create(self, **kwargs: Any):
        self.calls.append(kwargs)
        assert kwargs.get("stream") is True
        self.last_stream = FakeStream(self._events)
        return self.last_stream


class FakeStreamingSdk:
    def __init__(self, events: list[Any]) -> None:
        self.messages = FakeStreamingEndpoint(events)


def test_stream_beat_candidate_forwards_only_input_json_delta_fragments():
    events = [
        FakeMessageStart(message=FakeMessage(usage=FakeUsage(input_tokens=42, output_tokens=0))),
        FakeContentBlockDelta(delta=FakeInputJsonDelta('{"label":"x",')),
        FakeContentBlockDelta(delta=FakeInputJsonDelta('"scriptText":"hi"}')),
        FakeMessageDelta(usage=FakeUsage(input_tokens=42, output_tokens=17)),
    ]
    sdk = FakeStreamingSdk(events)
    client = AnthropicClient(sdk_client=sdk, models=_MODELS)

    frags = list(
        client.stream_beat_candidate(system="sys", user_message="hi", prompt_version="0.1.0")
    )
    assert frags == ['{"label":"x",', '"scriptText":"hi"}']

    call = sdk.messages.calls[0]
    assert call["model"] == "writer-model-x"
    assert call["stream"] is True
    assert call["tool_choice"] == {"type": "tool", "name": "generate_beat_candidates"}
    # fine-grained tool streaming enabled on the tool
    assert call["tools"][0]["eager_input_streaming"] is True


def test_stream_beat_candidate_ignores_second_tool_use_block():
    """claude-sonnet-5 has been observed emitting two tool_use blocks for the
    same forced tool; concatenating both JSON inputs breaks json.loads
    (Extra data) and surfaces as SCHEMA_INVALID_LLM in Write mode."""
    events = [
        FakeMessageStart(message=FakeMessage(usage=FakeUsage(input_tokens=10, output_tokens=0))),
        FakeContentBlockStart(content_block=FakeToolUseContentBlock(id="toolu_a"), index=0),
        FakeContentBlockDelta(delta=FakeInputJsonDelta('{"label":"first"}'), index=0),
        FakeContentBlockStart(content_block=FakeToolUseContentBlock(id="toolu_b"), index=1),
        FakeContentBlockDelta(delta=FakeInputJsonDelta('{"label":"second"}'), index=1),
        FakeMessageDelta(usage=FakeUsage(input_tokens=10, output_tokens=5)),
    ]
    sdk = FakeStreamingSdk(events)
    client = AnthropicClient(sdk_client=sdk, models=_MODELS)

    frags = list(
        client.stream_beat_candidate(system="sys", user_message="hi", prompt_version="0.1.0")
    )
    assert frags == ['{"label":"first"}']
    assert '{"label":"second"}' not in frags


def test_stream_beat_candidate_logs_metadata_never_content(caplog):
    secret = '{"scriptText":"Marta confesses she embezzled the money"}'
    events = [
        FakeMessageStart(message=FakeMessage(usage=FakeUsage(input_tokens=99, output_tokens=0))),
        FakeContentBlockDelta(delta=FakeInputJsonDelta(secret)),
        FakeMessageDelta(usage=FakeUsage(input_tokens=99, output_tokens=8)),
    ]
    client = AnthropicClient(sdk_client=FakeStreamingSdk(events), models=_MODELS)

    with caplog.at_level(logging.INFO, logger="llm.anthropic_client"):
        list(
            client.stream_beat_candidate(
                system="top secret", user_message="secret", prompt_version="7.2.1"
            )
        )

    assert len(caplog.records) == 1
    message = caplog.records[0].getMessage()
    assert "generate_beat_candidates" in message and "7.2.1" in message
    assert "writer-model-x" in message and "99" in message
    assert "Marta" not in message and "top secret" not in message


def test_stream_beat_candidate_closes_sdk_stream_on_client_disconnect():
    # §8a "no orphan spend": closing the generator mid-stream (what Starlette
    # does when the SSE client disconnects) must close the SDK stream so the
    # in-flight API request is cancelled.
    events = [
        FakeContentBlockDelta(delta=FakeInputJsonDelta('{"label":"x",')),
        FakeContentBlockDelta(delta=FakeInputJsonDelta('"scriptText":"hi"}')),
        FakeMessageDelta(usage=FakeUsage()),
    ]
    sdk = FakeStreamingSdk(events)
    client = AnthropicClient(sdk_client=sdk, models=_MODELS)

    gen = client.stream_beat_candidate(system="sys", user_message="hi", prompt_version="0.1.0")
    assert next(gen) == '{"label":"x",'  # stream is mid-flight
    gen.close()  # simulated client disconnect → GeneratorExit inside the generator

    assert sdk.messages.last_stream is not None
    assert sdk.messages.last_stream.closed is True


def test_stream_beat_candidate_closes_sdk_stream_on_normal_completion():
    events = [
        FakeContentBlockDelta(delta=FakeInputJsonDelta('{"scriptText":"hi"}')),
        FakeMessageDelta(usage=FakeUsage()),
    ]
    sdk = FakeStreamingSdk(events)
    client = AnthropicClient(sdk_client=sdk, models=_MODELS)

    list(client.stream_beat_candidate(system="sys", user_message="hi", prompt_version="0.1.0"))

    assert sdk.messages.last_stream.closed is True


def test_streaming_rule9_retry_never_replays_a_tool_use_turn():
    """The streaming rule-9 retry (`drama_manager/candidates.py`'s
    `_stream_one`) doesn't call `_retry_once` at all -- on a schema-invalid
    buffer it just re-invokes `stream_beat_candidate` with the error folded
    into a fresh plain-text `user_message` (mirroring `_retry_once`'s
    no-tool_use-id fallback). Each call here stands in for one of those two
    streamed attempts; every call must send exactly one user-role message
    with string content, so there is never a preceding assistant tool_use
    turn to be left without a matching tool_result -- the wire violation
    `_retry_once` had is structurally impossible for this path."""
    events = [FakeMessageDelta(usage=FakeUsage())]

    first_sdk = FakeStreamingSdk(events)
    first_client = AnthropicClient(sdk_client=first_sdk, models=_MODELS)
    list(
        first_client.stream_beat_candidate(system="sys", user_message="hi", prompt_version="0.1.0")
    )

    retry_user_message = (
        "hi\n\nYour previous response did not call the 'generate_beat_candidates' "
        "tool with valid input: 1 validation error. Call "
        "'generate_beat_candidates' with valid input."
    )
    retry_sdk = FakeStreamingSdk(events)
    retry_client = AnthropicClient(sdk_client=retry_sdk, models=_MODELS)
    list(
        retry_client.stream_beat_candidate(
            system="sys", user_message=retry_user_message, prompt_version="0.1.0"
        )
    )

    for sdk in (first_sdk, retry_sdk):
        messages = sdk.messages.calls[0]["messages"]
        assert len(messages) == 1
        assert messages[0]["role"] == "user"
        assert isinstance(messages[0]["content"], str)


def _fixture_valid_input_for(op_name: str) -> dict:
    return {
        "generate_beat_candidates": _VALID_BEAT_CANDIDATE_INPUT,
        "tune_beat": _VALID_BEAT_CANDIDATE_INPUT,
        "classify_blast_radius": {"impacted": []},
        "regenerate_elements": {"beats": [], "scenes": [], "continuityConflicts": []},
        "extract_ledger_facts": {"newFacts": [], "contradictions": []},
        "suggest_instructions": {"suggestions": ["a", "b", "c"]},
        "infer_act_breaks": {"starts": [{"act": 0, "startSceneIndex": 0}]},
        "infer_story_entities": {"characters": [], "relationships": [], "worldElements": []},
        "infer_narrative_promises": {
            "threads": [],
            "secrets": [],
            "sceneMotivations": [],
            "worldRules": [],
        },
        "infer_story_overview": {
            "logline": "When X must Y before Z.",
            "outline": [],
            "beatSheet": [],
            "summary": "Setup.\n\nResolution.",
        },
        "infer_narrative_map": {
            "dramaticQuestion": "Will Marta expose Dan before the evidence disappears?",
            "centralConflict": "Marta needs proof while Dan destroys it.",
            "controllingIdea": "Truth costs more when loyalty is involved.",
            "themes": [
                {
                    "label": "Loyalty",
                    "statement": "Loyalty can obstruct the truth.",
                    "evidence": [{"beatId": "beat-1"}],
                }
            ],
            "acts": [
                {
                    "act": 0,
                    "dramaticQuestion": "Can Marta make Dan answer?",
                    "escalation": "The evidence forces a confrontation.",
                    "turnBeatId": "beat-1",
                }
            ],
            "heroJourney": {
                "applies": False,
                "protagonistName": None,
                "rationale": "This fixture is too small for a meaningful journey lens.",
                "stages": [],
            },
            "characterArcs": [],
            "sceneTurns": [
                {
                    "sceneId": "scene-1",
                    "focalCharacterName": "Marta",
                    "dramaticFunction": "Set up the central confrontation.",
                    "conflict": "Marta presses Dan for the truth.",
                    "stakes": "The evidence may be lost.",
                    "turnBeatId": "beat-1",
                    "turn": "The accusation makes the conflict explicit.",
                }
            ],
            "threadMovements": [],
        },
        "infer_narrative_scene_analysis": {
            "scenes": [
                {
                    "sceneId": "scene-1",
                    "summary": "Marta discovers the transfer.",
                    "focalCharacterName": "Marta",
                    "dramaticFunction": "Establish the story problem.",
                    "conflict": "Marta needs an explanation from Dan.",
                    "stakes": "Their partnership may break.",
                    "turnBeatId": "beat-1",
                    "turn": "The discovery forces Marta to act.",
                    "keyMoments": [
                        {
                            "beatId": "beat-1",
                            "summary": "Marta sees the transfer.",
                            "dramaticFunction": "Plant the central question.",
                            "consequence": "Marta now has evidence to confront Dan.",
                        }
                    ],
                }
            ]
        },
        "infer_narrative_map_synthesis": {
            "dramaticQuestion": "Will Marta confront Dan before the evidence disappears?",
            "centralConflict": "Marta needs proof while Dan tries to contain the transfer.",
            "controllingIdea": "Loyalty is tested when the truth becomes dangerous.",
            "themes": [
                {
                    "label": "Loyalty",
                    "statement": "Loyalty can keep the truth hidden.",
                    "evidence": [{"beatId": "beat-1"}],
                }
            ],
            "acts": [
                {
                    "act": 0,
                    "dramaticQuestion": "Can Marta make Dan explain the transfer?",
                    "escalation": "The evidence forces a confrontation.",
                    "turnBeatId": "beat-1",
                }
            ],
            "heroJourney": {
                "applies": False,
                "protagonistName": None,
                "rationale": "This fixture is too small for a meaningful journey lens.",
                "stages": [],
            },
            "characterArcs": [],
            "threadMovements": [],
        },
        "verify_narrative_map": {
            "approved": True,
            "unsupportedPaths": [],
            "missingSceneIds": [],
            "issues": [],
        },
        "segment_scene": {"segments": []},
        "scan_consistency": {"flags": []},
        "generate_scene_skeleton": {"label": "x", "scenes": []},
    }[op_name]


# ---------------------------------------------------------------------------
# Import classifier ops: large scripts need more than DEFAULT_MAX_TOKENS
# (4096). Truncation mid-tool-input surfaces as SCHEMA_INVALID_LLM after the
# rule-9 retry — entities (~100+ speakers) and dense per-scene fact extracts.
# ---------------------------------------------------------------------------


_VALID_STORY_ENTITIES_INPUT = {
    "characters": [
        {
            "name": "Marta",
            "aliases": [],
            "role": "principal",
            "traits": "",
            "evidence": [{"sceneId": "scene-1", "quote": "hi"}],
        }
    ],
    "relationships": [],
    "worldElements": [],
}


def test_infer_story_entities_requests_elevated_max_tokens():
    sdk = FakeSdkClient(
        [
            FakeMessage(
                content=[
                    FakeToolUseBlock(
                        input=_VALID_STORY_ENTITIES_INPUT,
                        name="infer_story_entities",
                    )
                ]
            )
        ]
    )
    client = AnthropicClient(sdk_client=sdk, models=_MODELS)

    client.infer_story_entities(system="sys", user_message="hi", prompt_version="0.1.0")

    assert sdk.messages.calls[0]["max_tokens"] > 4096


def test_extract_ledger_facts_requests_elevated_max_tokens():
    sdk = FakeSdkClient(
        [
            FakeMessage(
                content=[
                    FakeToolUseBlock(
                        input={"newFacts": [], "contradictions": []},
                        name="extract_ledger_facts",
                    )
                ]
            )
        ]
    )
    client = AnthropicClient(sdk_client=sdk, models=_MODELS)

    client.extract_ledger_facts(system="sys", user_message="hi", prompt_version="0.1.0")

    assert sdk.messages.calls[0]["max_tokens"] > 4096


def test_default_ops_still_use_default_max_tokens():
    sdk = FakeSdkClient([_valid_response()])
    client = AnthropicClient(sdk_client=sdk, models=_MODELS)

    client.generate_beat_candidates(system="sys", user_message="hi", prompt_version="0.1.0")

    assert sdk.messages.calls[0]["max_tokens"] == 4096


def test_schema_invalid_logs_field_paths_not_values(caplog):
    """Hard rule 5: log path + error type only — never quote/script text."""
    secret = "SECRET_SCRIPT_LINE_SHOULD_NOT_APPEAR_IN_LOGS"
    bad = {
        "characters": [],
        "relationships": [
            {
                "betweenNames": ["OnlyOne"],
                "label": "friends",
                "reallyLike": "",
                "evidence": [{"sceneId": "scene-1", "quote": secret}],
            }
        ],
        "worldElements": [],
    }
    sdk = FakeSdkClient(
        [
            FakeMessage(
                content=[FakeToolUseBlock(input=bad, name="infer_story_entities", id="toolu_a")],
                stop_reason="max_tokens",
            ),
            FakeMessage(
                content=[FakeToolUseBlock(input=bad, name="infer_story_entities", id="toolu_b")],
                stop_reason="max_tokens",
            ),
        ]
    )
    client = AnthropicClient(sdk_client=sdk, models=_MODELS)

    with caplog.at_level(logging.WARNING, logger="llm.anthropic_client"):
        with pytest.raises(SchemaInvalidLlmError):
            client.infer_story_entities(system="sys", user_message="hi", prompt_version="0.1.0")

    joined = "\n".join(r.message for r in caplog.records)
    assert "llm_schema_invalid" in joined
    assert "betweenNames" in joined
    assert "stop_reason=max_tokens" in joined
    assert secret not in joined
    # Retry tool_result must also stay privacy-safe
    retry_messages = sdk.messages.calls[1]["messages"]
    tool_result = retry_messages[2]["content"][0]["content"]
    assert secret not in tool_result
    assert "betweenNames" in tool_result


def test_extract_without_cache_prefix_sends_a_plain_system_string():
    response = FakeMessage(
        content=[
            FakeToolUseBlock(
                input=_fixture_valid_input_for("extract_ledger_facts"),
                name="extract_ledger_facts",
            )
        ]
    )
    sdk = FakeSdkClient([response])
    client = AnthropicClient(sdk_client=sdk, models=_MODELS)

    client.extract_ledger_facts(
        system="sys", user_message="scene 1", prompt_version="0.33.0"
    )

    assert sdk.messages.calls[0]["system"] == "sys"


def test_extract_with_cache_prefix_marks_the_last_system_block_for_caching():
    """The cached prefix is what makes whole-episode context affordable.

    Caching is a byte-exact prefix match over tools -> system -> messages, so
    the breakpoint belongs on the LAST system block (the stable per-run source
    payload) and everything per-call stays in the user turn. A 1h TTL because
    an import runs for minutes across bounded workers and may resume from a
    checkpoint; the 5-minute default would silently buy a second full write.
    """
    response = FakeMessage(
        content=[
            FakeToolUseBlock(
                input=_fixture_valid_input_for("extract_ledger_facts"),
                name="extract_ledger_facts",
            )
        ]
    )
    sdk = FakeSdkClient([response])
    client = AnthropicClient(sdk_client=sdk, models=_MODELS)

    client.extract_ledger_facts(
        system="sys",
        user_message="scene 1",
        prompt_version="0.33.0",
        cache_prefix="WHOLE EPISODE",
    )

    system = sdk.messages.calls[0]["system"]
    assert system == [
        {"type": "text", "text": "sys"},
        {
            "type": "text",
            "text": "WHOLE EPISODE",
            "cache_control": {"type": "ephemeral", "ttl": "1h"},
        },
    ]
    # The per-call payload must stay after the breakpoint, or every call
    # writes its own cache entry and none of them ever reads one.
    assert sdk.messages.calls[0]["messages"] == [
        {"role": "user", "content": "scene 1"}
    ]


def test_schema_retry_reuses_the_same_cached_system_prefix():
    """A retry that rebuilt the prefix would pay a second full cache write."""
    bad = FakeMessage(content=[FakeToolUseBlock(input={"nope": 1}, name="extract_ledger_facts")])
    good = FakeMessage(
        content=[
            FakeToolUseBlock(
                input=_fixture_valid_input_for("extract_ledger_facts"),
                name="extract_ledger_facts",
            )
        ]
    )
    sdk = FakeSdkClient([bad, good])
    client = AnthropicClient(sdk_client=sdk, models=_MODELS)

    client.extract_ledger_facts(
        system="sys",
        user_message="scene 1",
        prompt_version="0.33.0",
        cache_prefix="WHOLE EPISODE",
    )

    assert len(sdk.messages.calls) == 2
    assert sdk.messages.calls[0]["system"] == sdk.messages.calls[1]["system"]
