"""Adoption A4: POST /projects/{pid}/suggest returns 3 chips; context includes
latest beat script when present.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from llm.dependency import get_llm_client
from llm.mock import MockLlmClient
from main import app
from storage.models import SuggestionHistoryRow

client = TestClient(app)
PROJECT_ID = "proj-longpour"


@pytest.fixture()
def mock_llm():
    llm = MockLlmClient()
    app.dependency_overrides[get_llm_client] = lambda: llm
    yield llm
    app.dependency_overrides.pop(get_llm_client, None)


def test_suggest_returns_three_strings(seeded_project, mock_llm):
    resp = client.post(
        f"/api/v1/projects/{PROJECT_ID}/suggest",
        json={
            "context": "scene",
            "targetId": "scene-3",
            "surface": "command_bar",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["suggestions"]) == 3
    assert all(isinstance(s, str) and s for s in body["suggestions"])


def test_suggest_records_history(seeded_project, mock_llm, db_session):
    before = (
        db_session.query(SuggestionHistoryRow)
        .filter_by(project_id=PROJECT_ID)
        .count()
    )
    client.post(
        f"/api/v1/projects/{PROJECT_ID}/suggest",
        json={
            "context": "scene",
            "targetId": "scene-3",
            "surface": "tune",
        },
    )
    after = (
        db_session.query(SuggestionHistoryRow)
        .filter_by(project_id=PROJECT_ID)
        .count()
    )
    assert after == before + 3


def test_suggest_missing_scene_404(seeded_project, mock_llm):
    resp = client.post(
        f"/api/v1/projects/{PROJECT_ID}/suggest",
        json={
            "context": "scene",
            "targetId": "scene-missing",
            "surface": "command_bar",
        },
    )
    assert resp.status_code == 404
