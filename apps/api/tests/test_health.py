import os

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_health_returns_ok() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_health_reports_which_llm_client_is_configured(monkeypatch) -> None:
    """Mock mode used to be visible only in the server log, so the app could
    not tell a writer that its analysis was fixture data."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("TABLEREAD_ALLOW_MOCK_LLM", "1")

    assert client.get("/health").json()["llmMode"] == "mock"


def test_health_is_reachable_under_the_api_prefix() -> None:
    """The browser only proxies /api, so this is the one the app can reach."""
    assert client.get("/api/v1/health").json() == client.get("/health").json()


def test_health_reports_unconfigured_without_raising(monkeypatch) -> None:
    """`resolve_client_mode` raises when nothing is set up, which is right at
    the point of use and wrong for a health check."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("TABLEREAD_ALLOW_MOCK_LLM", raising=False)

    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["llmMode"] == "unconfigured"


def test_health_reports_real_when_a_key_is_present(monkeypatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "not-a-real-key")

    assert client.get("/health").json()["llmMode"] == "real"
    assert os.environ["ANTHROPIC_API_KEY"] == "not-a-real-key"
