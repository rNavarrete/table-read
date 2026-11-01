"""The import spending limit (T11.3). Every model call is priced at a flat
$0.10 (`costs.call_cost_usd` patched), so a unit's projection is $0.10, its
"at most" (the cost model's high, 1.3x) $0.13 and a prewarm needs room for
itself plus one unit: $0.26. `MockLlmClient(priced=True)` only (hard rule 1)."""

from __future__ import annotations

import json
import re
import threading

import pytest
from fastapi.testclient import TestClient

import routes
from fountain import import_spend, pipeline
from fountain.parse import split_into_scenes
from llm import costs
from llm.dependency import get_llm_client
from llm.mock import MockLlmClient
from llm.ops import OP_REGISTRY
from main import app
from schemas import ProjectImportCreateRequest, SegmentedScene
from storage.models import (
    ConsistencyFlagRow,
    ImportRunRow,
    ImportRunUnitRow,
    LedgerFactRow,
    ProjectRow,
    SnapshotRow,
)

URL = "/api/v1/projects/import"
client = TestClient(app)


def _source(*names: str) -> str:
    return "\n".join(line for name in names for line in (f"INT. {name} - DAY", f"{name} waits."))


def _seg() -> SegmentedScene:
    return SegmentedScene.model_validate(
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


class _SlowAlphaLlm(MockLlmClient):
    """Alpha's segmentation is still running when the next unit is refused."""

    def __init__(self) -> None:
        super().__init__(priced=True)
        self.alpha_started = threading.Event()

    def segment_scene(self, *, system, user_message, prompt_version, cache_prefix=None):
        if "Alpha waits." in user_message:
            self.alpha_started.set()
            threading.Event().wait(0.3)
        super().segment_scene(
            system=system,
            user_message=user_message,
            prompt_version=prompt_version,
            cache_prefix=cache_prefix,
        )
        return _seg()


@pytest.fixture(autouse=True)
def flat_price(monkeypatch):
    monkeypatch.setattr(costs, "call_cost_usd", lambda model, usage, **kw: 0.10)


def _use(llm: MockLlmClient):
    app.dependency_overrides[get_llm_client] = lambda: llm


@pytest.fixture(autouse=True)
def _restore_llm():
    yield
    app.dependency_overrides.pop(get_llm_client, None)


def _post(key: str, src: str, max_cost_usd: float | None) -> list[tuple[str, dict]]:
    body: dict = {"title": "Limits", "source": {"format": "fountain", "content": src}}
    if max_cost_usd is not None:
        body["maxCostUsd"] = max_cost_usd
    text = client.post(URL, json=body, headers={"Idempotency-Key": key}).text
    return [
        (
            re.search(r"^event: (.*)$", frame, re.M).group(1),
            json.loads(re.search(r"^data: (.*)$", frame, re.M).group(1)),
        )
        for frame in text.strip().split("\n\n")
    ]


def _counts(db_session) -> dict:
    return {
        model: db_session.query(model).count()
        for model in (ProjectRow, SnapshotRow, LedgerFactRow, ConsistencyFlagRow)
    }


def _run(db_session, key: str) -> ImportRunRow:
    db_session.expire_all()
    return db_session.query(ImportRunRow).filter_by(idempotency_key=key).one()


def _units(db_session, run: ImportRunRow, stage: str) -> int:
    return db_session.query(ImportRunUnitRow).filter_by(run_id=run.id, stage=stage).count()


# The wizard's `about` for the two measured imports, from the same
# config/import_cost_model.json (importCostEstimate.test.ts asserts these
# numbers too): at the 1-hour cache writes those runs paid, and at 5 minutes.
PARITY = [
    (37, 41_874, "1h", 2.32),
    (179, 128_303, "1h", 8.96),
    (37, 41_874, "5m", 2.24),
    (179, 128_303, "5m", 8.75),
]


@pytest.mark.parametrize(("scenes", "chars", "tier", "about"), PARITY)
def test_the_projection_matches_the_wizard_estimate_to_the_cent(
    monkeypatch, scenes, chars, tier, about
):
    monkeypatch.undo()  # real prices for this one
    total = import_spend.projected_usd(scenes, chars, cache_write=tier)
    assert round(total, 2) == about


def test_the_cost_model_names_each_ops_role_and_stage():
    stages = {pipeline.CHECKPOINT_SCENE_MOTIVATIONS} | {
        getattr(pipeline, name) for name in dir(pipeline) if name.startswith("STAGE_")
    }
    for op, spec in import_spend.COST_MODEL["ops"].items():
        assert spec["role"] == OP_REGISTRY[op].role, op
        assert spec["stage"] in stages, op
    assert import_spend.AT_MOST == import_spend.COST_MODEL["range"]["high"]


def test_entity_chunks_follow_the_servers_rule():
    assert import_spend.entity_chunks(37, 41_874) == 6
    assert import_spend.entity_chunks(179, 128_303) == 22
    assert import_spend.entity_chunks(120, 1_000) == 10


def test_the_limit_stops_before_a_unit_that_would_cross_it(db_session, monkeypatch):
    monkeypatch.setattr(pipeline, "IMPORT_LLM_CONCURRENCY", 1)
    llm = MockLlmClient(priced=True)
    src = _source("Alpha", "Beta", "Gamma")
    llm.set_responses("segment_scene", [_seg() for _ in split_into_scenes(src)])
    _use(llm)
    before = _counts(db_session)
    key = "00000000-0000-4000-8000-00000000a301"

    # Prewarm 0.26 then three segments at 0.13 each fit under $0.45 as the
    # spend climbs to $0.40; the acts call would need $0.53.
    events = _post(key, src, 0.45)

    name, data = events[-1]
    assert name == "failed"
    assert data["error"]["code"] == "IMPORT_SPEND_LIMIT"
    assert data["error"]["details"]["spentUsd"] == 0.4
    assert data["error"]["details"]["maxCostUsd"] == 0.45
    assert data["error"]["details"]["remainingUsd"] > 0
    assert data["error"]["message"] == "paused at $0.40 of your $0.45 limit"
    assert llm.invocation_count("segment_scene") == 3
    assert llm.invocation_count("infer_act_breaks") == 0
    # Never fabricate: no project, no snapshot; every paid unit is kept.
    assert _counts(db_session) == before
    run = _run(db_session, key)
    assert (run.status, run.error_code) == ("failed", "IMPORT_SPEND_LIMIT")
    assert _units(db_session, run, "segmenting_beats") == 3
    assert run.cost["importCostUsd"] == pytest.approx(0.4)


def test_in_flight_calls_finish_and_are_saved_when_the_limit_stops_the_next(
    db_session, monkeypatch
):
    monkeypatch.setattr(pipeline, "IMPORT_LLM_CONCURRENCY", 2)
    llm = _SlowAlphaLlm()
    _use(llm)
    key = "00000000-0000-4000-8000-00000000a302"

    # Prewarm ($0.10 spent), then Alpha and Beta start together; Beta lands
    # ($0.20) while Alpha runs, and Gamma's 0.20 + 0.13 + 0.13 > $0.40.
    events = _post(key, _source("Alpha", "Beta", "Gamma", "Delta"), 0.40)

    assert events[-1][1]["error"]["code"] == "IMPORT_SPEND_LIMIT"
    assert llm.alpha_started.is_set()
    assert llm.invocation_count("segment_scene") == 2
    run = _run(db_session, key)
    assert _units(db_session, run, "segmenting_beats") == 2
    assert run.cost["importCostUsd"] == pytest.approx(0.30)


def test_continue_with_a_higher_limit_resumes_and_spends_nothing_twice(
    db_session, monkeypatch
):
    monkeypatch.setattr(pipeline, "IMPORT_LLM_CONCURRENCY", 1)
    llm = MockLlmClient(priced=True)
    src = _source("Alpha", "Beta", "Gamma")
    llm.set_responses("segment_scene", [_seg() for _ in split_into_scenes(src)])
    _use(llm)
    key = "00000000-0000-4000-8000-00000000a303"
    paused = _post(key, src, 0.45)
    assert paused[-1][1]["error"]["code"] == "IMPORT_SPEND_LIMIT"
    run_id = _run(db_session, key).id
    calls_before = len(llm.usage_log)

    # Not a changed request: no IDEMPOTENCY_CONFLICT, the same run, its units.
    resumed = _post(key, src, 5.0)

    assert resumed[-1][0] == "complete"
    run = _run(db_session, key)
    assert run.id == run_id
    assert run.status == "completed"
    assert llm.invocation_count("segment_scene") == 3
    assert llm.invocation_count("prewarm_cache:segment_scene") == 1
    cached = [d for n, d in resumed if n == "found" and d["stage"] == "segmenting_beats"]
    assert cached and all(d["cached"] for d in cached)
    # One total across both attempts: $0.10 for every call ever made.
    assert run.cost["importCostUsd"] == pytest.approx(0.10 * len(llm.usage_log))
    assert len(llm.usage_log) > calls_before


def test_stop_leaves_the_paused_run_resumable_without_a_limit(db_session, monkeypatch):
    monkeypatch.setattr(pipeline, "IMPORT_LLM_CONCURRENCY", 1)
    llm = MockLlmClient(priced=True)
    src = _source("Alpha", "Beta")
    llm.set_responses("segment_scene", [_seg() for _ in split_into_scenes(src)])
    _use(llm)
    key = "00000000-0000-4000-8000-00000000a304"
    # The same limit again pauses again, before any model call.
    assert _post(key, src, 0.3)[-1][1]["error"]["code"] == "IMPORT_SPEND_LIMIT"
    calls = len(llm.usage_log)
    assert _post(key, src, 0.3)[-1][1]["error"]["code"] == "IMPORT_SPEND_LIMIT"
    assert len(llm.usage_log) == calls

    assert _post(key, src, None)[-1][0] == "complete"
    assert llm.invocation_count("segment_scene") == 2


def test_raising_the_limit_is_not_a_changed_request():
    def body(limit):
        return ProjectImportCreateRequest.model_validate(
            {
                "title": "T",
                "source": {"format": "text", "content": "x"},
                **({} if limit is None else {"maxCostUsd": limit}),
            }
        )

    assert routes._creation_request_hash(body(None)) == routes._creation_request_hash(
        body(4.0)
    )
    assert routes._creation_request_hash(body(4.0)) == routes._creation_request_hash(
        body(8.0)
    )


def test_a_limit_must_be_positive(db_session):
    body = {"title": "T", "source": {"format": "text", "content": "x"}, "maxCostUsd": 0}
    response = client.post(URL, json=body, headers={"Idempotency-Key": "k-a305"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION"


def test_remaining_counts_only_unsaved_units():
    limit = import_spend.SpendLimit(costs.CostMeter(), 1.0)
    limit.plan(3, 1_000)
    everything = limit.remaining_usd({})
    # 3 segments + prewarm, acts, 1 cast chunk, threads, motivations,
    # overview, 3 facts + prewarm, consistency: 14 calls at $0.10.
    assert everything == pytest.approx(1.4)
    saved = {"segmenting_beats": {"0": {}, "1": {}, "2": {}}, "inferring_acts": {"sceneActs": []}}
    assert limit.remaining_usd(saved) == pytest.approx(1.4 - 0.4 - 0.1)
