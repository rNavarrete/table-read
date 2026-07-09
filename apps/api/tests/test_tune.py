"""POST /projects/{pid}/scenes/{sid}/candidates/tune — the tune SSE endpoint
(data contract §4: "SSE, one candidate"). MockLlmClient via dependency override
(hard rule 1); tune is read-only w.r.t. the doc (Accept persists, tune does not).
"""

from __future__ import annotations

import json

import anthropic
import httpx
import pytest
from fastapi.testclient import TestClient

from llm.dependency import get_llm_client
from llm.mock import MockLlmClient
from main import app
from schemas import BeatCandidate
from storage.models import SnapshotRow

PROJECT_ID = "proj-longpour"
URL = f"/api/v1/projects/{PROJECT_ID}/scenes/scene-3/candidates/tune"


def _cand(label: str, script: str = "MARTA\nColder now.") -> BeatCandidate:
    return BeatCandidate(
        label=label,
        beatPlan={"whatHappens": "w", "audienceLearns": "l", "audienceFeels": "f"},
        scriptText=script,
        continuityConflicts=[],
    )


def _body(instruction: str = "make it colder") -> dict:
    return {
        "candidate": {
            "label": "Quiet reveal",
            "beatPlan": {"whatHappens": "w", "audienceLearns": "l", "audienceFeels": "f"},
            "scriptText": "MARTA\nYou tell me.",
            "continuityConflicts": [],
        },
        "instruction": instruction,
    }


def _parse_sse(text: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    for frame in text.strip().split("\n\n"):
        if not frame.strip():
            continue
        lines = frame.splitlines()
        name = next(line[len("event: ") :] for line in lines if line.startswith("event: "))
        data = next(line[len("data: ") :] for line in lines if line.startswith("data: "))
        events.append((name, json.loads(data)))
    return events


@pytest.fixture()
def mock_llm():
    client = MockLlmClient()
    app.dependency_overrides[get_llm_client] = lambda: client
    yield client
    app.dependency_overrides.pop(get_llm_client, None)


client = TestClient(app)


def test_tune_streams_one_candidate_done_then_done(seeded_project, mock_llm):
    mock_llm.set_response("tune_beat", _cand("Deflected ambush"))
    resp = client.post(URL, json=_body())

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    events = _parse_sse(resp.text)
    names = [n for n, _ in events]
    assert names[0] == "candidate_start"
    assert names.count("candidate_done") == 1  # exactly one candidate
    assert names[-1] == "done"

    done = next(d for n, d in events if n == "candidate_done")
    assert done["label"] == "Deflected ambush"
    BeatCandidate.model_validate(done)  # schema-valid


def test_tune_read_only_no_snapshot(seeded_project, db_session, mock_llm):
    before = db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()
    mock_llm.set_response("tune_beat", _cand("X"))
    client.post(URL, json=_body())
    after = db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()
    assert after == before  # tuning persists nothing


def test_tune_streams_clean_deltas_and_authoritative_done(seeded_project, mock_llm):
    # a fragmented tool-input stream (split mid-way through scriptText) must
    # yield clean unescaped delta text and an authoritative candidate_done.
    card = _cand("Power shift", script="Line one.\nLine two.")
    full = card.model_dump_json(by_alias=True)
    mid = full.index("Line one") + 4
    mock_llm.set_tune_streams([[full[:mid], full[mid:]]])

    events = _parse_sse(client.post(URL, json=_body()).text)
    deltas = "".join(d["text"] for n, d in events if n == "delta")
    assert deltas == "Line one.\nLine two."  # unescaped, complete
    done = next(d for n, d in events if n == "candidate_done")
    assert done["scriptText"] == "Line one.\nLine two."  # authoritative


def test_tune_scene_not_found_404(seeded_project, mock_llm):
    resp = client.post(
        f"/api/v1/projects/{PROJECT_ID}/scenes/scene-999/candidates/tune", json=_body()
    )
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


def test_tune_missing_project_404(mock_llm):
    resp = client.post("/api/v1/projects/nope/scenes/scene-3/candidates/tune", json=_body())
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


def test_tune_missing_instruction_422(seeded_project, mock_llm):
    resp = client.post(URL, json={"candidate": _body()["candidate"]})
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "VALIDATION"


class _UnavailableLlm(MockLlmClient):
    def stream_tune_beat(self, *, system, user_message, prompt_version):
        raise anthropic.APIConnectionError(request=httpx.Request("POST", "https://api.anthropic.com"))
        yield  # pragma: no cover - makes this a generator


def test_tune_transport_error_is_sse_shaped_llm_unavailable(seeded_project):
    app.dependency_overrides[get_llm_client] = lambda: _UnavailableLlm()
    try:
        resp = client.post(URL, json=_body())
    finally:
        app.dependency_overrides.pop(get_llm_client, None)

    assert resp.status_code == 200  # stream already began
    events = _parse_sse(resp.text)
    failed = [d for n, d in events if n == "candidate_failed"]
    assert len(failed) == 1
    assert failed[0]["error"]["code"] == "LLM_UNAVAILABLE"
    assert events[-1][0] == "done"


def test_tune_schema_invalid_stream_fails_after_retry(seeded_project, mock_llm):
    # a stream whose complete buffer is valid JSON but not a BeatCandidate:
    # rule 9 → one retry (same bad stream), then candidate_failed SCHEMA_INVALID_LLM.
    bad = json.dumps({"not": "a candidate"})
    mock_llm.set_tune_streams([[bad], [bad]])  # attempt + one retry
    events = _parse_sse(client.post(URL, json=_body()).text)
    failed = [d for n, d in events if n == "candidate_failed"]
    assert len(failed) == 1
    assert failed[0]["error"]["code"] == "SCHEMA_INVALID_LLM"
    assert events[-1][0] == "done"
