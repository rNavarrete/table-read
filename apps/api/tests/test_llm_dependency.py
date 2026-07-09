"""The `LlmClient` dependency's mock opt-in gate (T2.3 review).

Three arms (llm/dependency.py `resolve_client_mode`):

  1. `ANTHROPIC_API_KEY` set → "real". Tested at the mode level only: actually
     constructing the real client from a test is forbidden (CLAUDE.md hard
     rule 1, enforced by tests/test_llm_factory.py's cross-test guard, which
     fails if any other test module so much as references the factory).
     `resolve_client_mode` exists precisely so this arm has a testable seam
     short of construction.
  2. no key + `TABLEREAD_ALLOW_MOCK_LLM=1` → `MockLlmClient`, with a WARNING
     log (configuration wording only — rule 5).
  3. no key + no flag → 503 `LLM_UNAVAILABLE` ApiError naming both the missing
     key and the flag. A production deploy that forgets the key must fail
     loudly, never silently serve canned candidates that get snapshotted as
     real content.
"""

from __future__ import annotations

import logging

import pytest

import llm.dependency as dependency_module
from errors import ApiError
from llm.dependency import MOCK_FLAG, get_llm_client, resolve_client_mode
from llm.mock import MockLlmClient


@pytest.fixture(autouse=True)
def _clean_env_and_cache(monkeypatch):
    """Every test starts keyless, flagless, and with no cached client."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv(MOCK_FLAG, raising=False)
    dependency_module._client = None
    yield
    dependency_module._client = None


# ── arm 1: key present → real (mode-level; construction is test-forbidden) ───


def test_mode_is_real_when_api_key_is_set(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test-not-a-real-key")
    assert resolve_client_mode() == "real"


def test_key_wins_over_the_mock_flag(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test-not-a-real-key")
    monkeypatch.setenv(MOCK_FLAG, "1")
    assert resolve_client_mode() == "real"


# ── arm 2: no key + flag → mock, loudly ───────────────────────────────────────


def test_flag_opts_in_to_mock_client_and_logs_a_warning(monkeypatch, caplog):
    monkeypatch.setenv(MOCK_FLAG, "1")
    with caplog.at_level(logging.WARNING, logger="llm.dependency"):
        client = get_llm_client()
    assert isinstance(client, MockLlmClient)
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1
    message = warnings[0].getMessage()
    assert MOCK_FLAG in message
    assert "MockLlmClient" in message


def test_flag_values_other_than_1_do_not_enable_the_mock(monkeypatch):
    for value in ("true", "yes", "0", ""):
        monkeypatch.setenv(MOCK_FLAG, value)
        with pytest.raises(ApiError):
            resolve_client_mode()


# ── arm 3: no key + no flag → clear, named 503 ────────────────────────────────


def test_missing_key_without_flag_raises_llm_unavailable_naming_both():
    with pytest.raises(ApiError) as excinfo:
        get_llm_client()
    err = excinfo.value
    assert err.status_code == 503
    assert err.code == "LLM_UNAVAILABLE"
    assert "ANTHROPIC_API_KEY" in err.message
    assert MOCK_FLAG in err.message


def test_empty_string_key_without_flag_also_raises(monkeypatch):
    # An exported-but-empty key is still a missing key, not a real credential.
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    with pytest.raises(ApiError) as excinfo:
        get_llm_client()
    assert excinfo.value.code == "LLM_UNAVAILABLE"


def test_error_arm_caches_nothing_so_fixing_the_env_recovers(monkeypatch):
    with pytest.raises(ApiError):
        get_llm_client()
    monkeypatch.setenv(MOCK_FLAG, "1")
    assert isinstance(get_llm_client(), MockLlmClient)


# ── caching ───────────────────────────────────────────────────────────────────


def test_client_is_cached_across_calls():
    sentinel = MockLlmClient()
    dependency_module._client = sentinel
    assert get_llm_client() is sentinel
