"""POST /projects/{pid}/scenes/{sid}/candidates — the SSE endpoint end-to-end
(data contract §4). MockLlmClient injected via dependency override (hard rule 1);
the endpoint is read-only w.r.t. the doc (T2.1 persists nothing).
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
URL = f"/api/v1/projects/{PROJECT_ID}/scenes/scene-3/candidates"


def _cand(label: str) -> BeatCandidate:
    return BeatCandidate(
        label=label,
        beatPlan={"whatHappens": "w", "audienceLearns": "l", "audienceFeels": "f"},
        scriptText="MARTA\nYou tell me.",
        continuityConflicts=[],
    )


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


def test_streams_three_candidate_done_then_done(seeded_project, mock_llm):
    mock_llm.set_responses(
        "generate_beat_candidates",
        [_cand("Quiet reveal"), _cand("Deflected ambush"), _cand("Power shift")],
    )
    resp = client.post(URL, json={"afterBeatId": "beat-3-1"})

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    events = _parse_sse(resp.text)

    names = [n for n, _ in events]
    assert names.count("candidate_done") == 3
    assert names[-1] == "done"
    dones = [d for n, d in events if n == "candidate_done"]
    assert [c["label"] for c in dones] == ["Quiet reveal", "Deflected ambush", "Power shift"]
    for wire in dones:
        BeatCandidate.model_validate(wire)  # schema-valid


def test_candidate_done_is_terminal_for_its_candidate(seeded_project, mock_llm):
    # cards become actionable only after candidate_done: for each candidate
    # block, candidate_done is the last event before the next start / done.
    mock_llm.set_responses("generate_beat_candidates", [_cand("A"), _cand("B"), _cand("C")])
    events = _parse_sse(client.post(URL, json={"afterBeatId": "beat-3-1"}).text)

    start_idxs = [i for i, (n, _) in enumerate(events) if n == "candidate_start"]
    for k, start in enumerate(start_idxs):
        end = start_idxs[k + 1] if k + 1 < len(start_idxs) else len(events) - 1  # 'done'
        block = events[start + 1 : end]  # events between this start and the next
        # the terminal event is candidate_done/failed; only deltas precede it
        assert block[-1][0] in ("candidate_done", "candidate_failed")
        assert all(n == "delta" for n, _ in block[:-1])


def test_read_only_no_snapshot_created(seeded_project, db_session, mock_llm):
    before = db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()
    mock_llm.set_responses("generate_beat_candidates", [_cand("A"), _cand("B"), _cand("C")])
    client.post(URL, json={"afterBeatId": "beat-3-1"})
    after = db_session.query(SnapshotRow).filter_by(project_id=PROJECT_ID).count()
    assert after == before  # generation persists nothing (Accept is T2.2)


def test_scene_not_found_404(seeded_project, mock_llm):
    resp = client.post(
        f"/api/v1/projects/{PROJECT_ID}/scenes/scene-999/candidates", json={}
    )
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


def test_bad_after_beat_id_400(seeded_project, mock_llm):
    resp = client.post(URL, json={"afterBeatId": "beat-nope"})
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "VALIDATION"


def test_missing_project_404(mock_llm):
    resp = client.post("/api/v1/projects/nope/scenes/scene-3/candidates", json={})
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


class _UnavailableLlm(MockLlmClient):
    def stream_beat_candidate(self, *, system, user_message, prompt_version):
        raise anthropic.APIConnectionError(request=httpx.Request("POST", "https://api.anthropic.com"))
        yield  # pragma: no cover - makes this a generator


def test_transport_error_is_sse_shaped_llm_unavailable(seeded_project):
    app.dependency_overrides[get_llm_client] = lambda: _UnavailableLlm()
    try:
        resp = client.post(URL, json={"afterBeatId": "beat-3-1"})
    finally:
        app.dependency_overrides.pop(get_llm_client, None)

    # stream already began (200); the error is an SSE candidate_failed event
    assert resp.status_code == 200
    events = _parse_sse(resp.text)
    failed = [d for n, d in events if n == "candidate_failed"]
    assert len(failed) == 3
    assert all(f["error"]["code"] == "LLM_UNAVAILABLE" for f in failed)
    assert events[-1][0] == "done"


def test_empty_body_defaults_to_top_of_scene(seeded_project, mock_llm):
    mock_llm.set_responses("generate_beat_candidates", [_cand("A"), _cand("B"), _cand("C")])
    resp = client.post(URL, json={})
    assert resp.status_code == 200
    assert [n for n, _ in _parse_sse(resp.text)].count("candidate_done") == 3
