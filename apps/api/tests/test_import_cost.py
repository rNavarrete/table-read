"""Import cost (T11.1): pricing over config/llm_pricing.json, the per-run
meter, `spentUsd` on progress frames, the stored receipt and count-only logs.
`MockLlmClient(priced=True)` or a hand-built fake SDK only (hard rule 1)."""

from __future__ import annotations

import json
import logging
import re
import threading
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from fountain.parse import split_into_scenes
from llm import costs
from llm.anthropic_client import AnthropicClient
from llm.dependency import get_llm_client
from llm.errors import SchemaInvalidLlmError
from llm.mock import MockLlmClient
from llm.ops import model_pins
from main import app
from schemas import SegmentedScene
from storage.models import ImportRunRow

URL = "/api/v1/projects/import"
SOURCE = "\n".join(
    [
        "INT. BAR - NIGHT",
        "Dan pours a drink for the stranger.",
        "INT. OFFICE - DAY",
        "Marta opens the ledger and frowns.",
        "EXT. DOCK - NIGHT",
        "The ferry horn sounds twice.",
    ]
)
client = TestClient(app)


def _usage(inp=0, out=0, write=0, read=0) -> SimpleNamespace:
    return SimpleNamespace(
        input_tokens=inp,
        output_tokens=out,
        cache_creation_input_tokens=write,
        cache_read_input_tokens=read,
    )


# ── pricing ─────────────────────────────────────────────────────────────────

M = 1_000_000


@pytest.mark.parametrize(
    ("model", "inp", "out", "read"),
    [
        ("claude-opus-5-5", 4.0, 20.0, 0.2),
        ("claude-sonnet-5-5", 2.0, 10.0, 0.1),
        ("claude-haiku-5-5", 0.1, 0.5, 0.01),
    ],
)
def test_each_model_is_priced_per_million_tokens(model, inp, out, read):
    assert costs.call_cost_usd(model, _usage(inp=M // 20)) == pytest.approx(inp / 20)
    assert costs.call_cost_usd(model, _usage(out=M // 20)) == pytest.approx(out / 20)
    assert costs.call_cost_usd(model, _usage(read=M // 20)) == pytest.approx(read / 20)


def test_cache_writes_cost_1_25x_input_for_5_minutes_and_2x_for_1_hour():
    usage = _usage(write=M // 10)
    assert costs.call_cost_usd("claude-opus-5-5", usage) == pytest.approx(0.4 * 1.25)
    assert costs.call_cost_usd("claude-opus-5-5", usage, cache_write="1h") == pytest.approx(0.8)


def test_the_apis_own_cache_write_split_prices_each_tier():
    usage = _usage(write=300_000)
    usage.cache_creation = SimpleNamespace(
        ephemeral_5m_input_tokens=100_000, ephemeral_1h_input_tokens=200_000
    )
    assert costs.cache_writes(usage) == (100_000, 200_000)
    assert costs.call_cost_usd("claude-sonnet-5-5", usage) == pytest.approx(
        0.1 * 2 * 1.25 + 0.2 * 2 * 2
    )
    # Without a split, every write is at the tier the request sent.
    assert costs.cache_writes(_usage(write=7)) == (7, 0)
    assert costs.cache_writes(_usage(write=7), "1h") == (0, 7)


def test_haiku_is_priced_at_its_long_prompt_rates_over_100k_prompt_tokens():
    at_limit = _usage(inp=60_000, read=40_000, out=1_000)
    assert costs.call_cost_usd("claude-haiku-5-5", at_limit) == pytest.approx(
        (60_000 * 0.1 + 40_000 * 0.01 + 1_000 * 0.5) / M
    )
    # Cache writes and reads count toward the prompt, not just input.
    over = _usage(inp=60_000, write=20_000, read=20_001, out=1_000)
    assert costs.call_cost_usd("claude-haiku-5-5", over) == pytest.approx(
        (60_000 * 0.5 + 20_000 * 0.5 * 1.25 + 20_001 * 0.05 + 1_000 * 2.5) / M
    )


def test_an_unknown_model_costs_unknown_and_is_never_guessed():
    assert costs.call_cost_usd("claude-mystery-9", _usage(inp=1_000)) is None
    meter = costs.CostMeter()
    meter.add("segmenting_beats", None, _usage(inp=1_000))
    snapshot = meter.snapshot()
    assert snapshot["importCostUsd"] == 0
    assert snapshot["unpricedCalls"] == 1
    assert snapshot["stages"]["segmenting_beats"]["inputTokens"] == 1_000
    assert costs.cost_field(None) == "unknown"


# ── the meter ───────────────────────────────────────────────────────────────


def test_the_meter_sums_concurrent_calls_exactly():
    meter = costs.CostMeter()

    def worker():
        for _ in range(500):
            meter.add("extracting_facts", 0.01, _usage(inp=10, out=2))

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    snapshot = meter.snapshot()
    assert snapshot["importCostUsd"] == pytest.approx(40.0)
    assert snapshot["stages"]["extracting_facts"]["calls"] == 4_000
    assert snapshot["stages"]["extracting_facts"]["inputTokens"] == 40_000


def test_a_meter_resumes_from_a_saved_snapshot():
    first = costs.CostMeter()
    first.add("segmenting_beats", 1.5, _usage(inp=10))
    resumed = costs.CostMeter(json.loads(json.dumps(first.snapshot())))
    resumed.add("segmenting_beats", 0.5, _usage(inp=5))

    assert resumed.spent_usd == pytest.approx(2.0)
    assert resumed.snapshot()["stages"]["segmenting_beats"]["calls"] == 2


# ── the real client meters every billed response ────────────────────────────


class _Messages:
    def __init__(self, responses: list) -> None:
        self.responses = list(responses)

    def create(self, **kwargs):
        return self.responses.pop(0)

    @property
    def with_raw_response(self):
        return SimpleNamespace(
            create=lambda **kwargs: SimpleNamespace(
                headers={}, parse=lambda message=self.create(**kwargs): message
            )
        )


def _reply(suggestions: list[str], usage: SimpleNamespace) -> SimpleNamespace:
    block = SimpleNamespace(
        type="tool_use",
        name="suggest_instructions",
        id="toolu_1",
        input={"suggestions": suggestions},
    )
    return SimpleNamespace(content=[block], usage=usage, stop_reason="tool_use", id="msg_1")


def _client(responses: list) -> AnthropicClient:
    return AnthropicClient(
        sdk_client=SimpleNamespace(messages=_Messages(responses)), models=model_pins()
    )


def test_a_retried_call_meters_both_attempts_and_logs_cost(caplog):
    haiku = model_pins()["classifier"]
    first, second = _usage(inp=1_000, out=200), _usage(inp=1_300, out=150)
    llm = _client([_reply(["only one"], first), _reply(["a", "b", "c"], second)])
    meter = costs.CostMeter()

    with caplog.at_level(logging.INFO, logger="llm.anthropic_client"), costs.metering(meter):
        llm.suggest_instructions(system="s", user_message="u", prompt_version="0")

    expected = costs.call_cost_usd(haiku, first) + costs.call_cost_usd(haiku, second)
    assert meter.spent_usd == pytest.approx(expected)
    # Each billed attempt has its own line, so the log adds up to the bill.
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("llm_call ")]
    assert len(lines) == 2
    assert "retried=False failed=True" in lines[0] and "input_tokens=1000" in lines[0]
    assert f"cost_usd={costs.cost_field(costs.call_cost_usd(haiku, first))}" in lines[0]
    assert "retried=True failed=False" in lines[1]
    assert f"cost_usd={costs.cost_field(costs.call_cost_usd(haiku, second))}" in lines[1]


def test_a_call_that_fails_validation_twice_is_still_metered():
    haiku = model_pins()["classifier"]
    usage = _usage(inp=900, out=100)
    llm = _client([_reply(["x"], usage), _reply(["y"], usage)])
    meter = costs.CostMeter()

    with costs.metering(meter), pytest.raises(SchemaInvalidLlmError):
        llm.suggest_instructions(system="s", user_message="u", prompt_version="0")

    assert meter.spent_usd == pytest.approx(2 * costs.call_cost_usd(haiku, usage))


def test_a_prewarm_is_metered_and_logs_its_cost(caplog):
    sonnet = model_pins()["import_worker"]
    usage = _usage(inp=40, write=30_000)
    warm = SimpleNamespace(content=[], usage=usage, stop_reason="max_tokens", id="msg_2")
    llm = _client([warm])
    meter = costs.CostMeter()

    with caplog.at_level(logging.INFO, logger="llm.anthropic_client"), costs.metering(meter):
        llm.prewarm_cache("segment_scene", system="s", user_message="u", cache_prefix="p")

    assert meter.spent_usd == pytest.approx(costs.call_cost_usd(sonnet, usage))
    [line] = [r.getMessage() for r in caplog.records if r.getMessage().startswith("llm_prewarm")]
    assert "cache_write=30000 cache_write_5m=30000 cache_write_1h=0" in line
    assert "cost_usd=0.075080" in line


# ── an import run: progress, receipt, logs, resume ──────────────────────────


@pytest.fixture()
def priced_llm():
    llm = MockLlmClient(priced=True)
    llm.set_responses(
        "segment_scene",
        [
            SegmentedScene.model_validate(
                {
                    "segments": [
                        {
                            "kind": "beat",
                            "startLine": 1,
                            "whatHappens": "w",
                            "audienceLearns": "l",
                            "audienceFeels": "f",
                        }
                    ]
                }
            )
            for _ in split_into_scenes(SOURCE)
        ],
    )
    app.dependency_overrides[get_llm_client] = lambda: llm
    yield llm
    app.dependency_overrides.pop(get_llm_client, None)


def _post(key: str) -> list[tuple[str, dict]]:
    body = {"title": "Ferry", "source": {"format": "fountain", "content": SOURCE}}
    text = client.post(URL, json=body, headers={"Idempotency-Key": key}).text
    events = []
    for frame in text.strip().split("\n\n"):
        name = re.search(r"^event: (.*)$", frame, re.M).group(1)
        events.append((name, json.loads(re.search(r"^data: (.*)$", frame, re.M).group(1))))
    return events


def _priced_total(llm: MockLlmClient) -> float:
    return sum(costs.call_cost_usd(model, usage) for model, usage in llm.usage_log)


def test_progress_carries_spent_usd_and_the_completed_run_keeps_its_receipt(
    db_session, priced_llm, caplog
):
    key = "00000000-0000-4000-8000-0000000c0571"
    with caplog.at_level(logging.INFO, logger="fountain.create_import"):
        events = _post(key)

    assert events[-1][0] == "complete"
    spent = [data["spentUsd"] for name, data in events if name == "progress"]
    assert spent == sorted(spent)
    total = _priced_total(priced_llm)
    assert total > 0
    assert spent[-1] == round(total, 2)

    run = db_session.query(ImportRunRow).filter_by(idempotency_key=key).one()
    assert run.status == "completed"
    assert run.cost["importCostUsd"] == pytest.approx(total)
    stages = run.cost["stages"]
    assert {"segmenting_beats", "inferring_acts", "inferring_motivations"} <= set(stages)
    # The segmentation prewarm is metered under its stage, not as "-".
    assert "-" not in stages
    assert sum(row["calls"] for row in stages.values()) == len(priced_llm.usage_log)
    assert sum(row["costUsd"] for row in stages.values()) == pytest.approx(total)

    [line] = [r.getMessage() for r in caplog.records if r.getMessage().startswith("import_cost")]
    assert re.fullmatch(
        r"import_cost run_id=import-[\w-]+ stage=\w+ total_usd=\d+\.\d{6} unpriced_calls=0"
        r"( \w+_usd=\d+\.\d{6})+",
        line,
    )
    assert "Marta" not in line and "ferry" not in line.lower()


def test_demo_mode_reports_zero_spend(db_session, priced_llm):
    priced_llm.priced = False
    events = _post("00000000-0000-4000-8000-0000000c0572")

    assert events[-1][0] == "complete"
    assert {data["spentUsd"] for name, data in events if name == "progress"} == {0}


def test_a_resumed_run_continues_the_same_total(db_session, priced_llm, monkeypatch):
    key = "00000000-0000-4000-8000-0000000c0573"
    original = priced_llm.infer_story_entities

    def fail(**kwargs):
        raise SchemaInvalidLlmError("infer_story_entities")

    monkeypatch.setattr(priced_llm, "infer_story_entities", fail)
    failed = _post(key)
    assert failed[-1][1]["error"]["code"] == "SCHEMA_INVALID_LLM"
    db_session.expire_all()
    run = db_session.query(ImportRunRow).filter_by(idempotency_key=key).one()
    spent_before = run.cost["importCostUsd"]
    assert spent_before == pytest.approx(_priced_total(priced_llm))
    calls_before = len(priced_llm.usage_log)

    monkeypatch.setattr(priced_llm, "infer_story_entities", original)
    resumed = _post(key)

    assert resumed[-1][0] == "complete"
    db_session.expire_all()
    run = db_session.query(ImportRunRow).filter_by(idempotency_key=key).one()
    assert len(priced_llm.usage_log) > calls_before
    assert run.cost["importCostUsd"] == pytest.approx(_priced_total(priced_llm))
    # The resumed attempt's first frame already counts the earlier spend.
    first = next(data for name, data in resumed if name == "progress")
    assert first["spentUsd"] == round(spent_before, 2)
