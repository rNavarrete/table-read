"""Regression test for the dev-mode `LlmClient` fallback (T2.3).

Before this fix, `get_llm_client()` unconditionally reached for the real
Anthropic-backed client, which raises `KeyError` the instant no API key is
configured. `make dev` and any Playwright e2e harness run uvicorn directly
with no dependency override and (by default) no API key exported, so every
LLM-backed route 500'd with a bare, unhandled exception before this fix. This
test proves the missing-key branch resolves to `MockLlmClient` instead.

Deliberately not covered here: the key-present branch (unchanged by this
fix). Exercising it would mean naming the real-client construction path in
this file, which `test_llm_factory.py`'s own cross-test guard forbids outside
its own module (CLAUDE.md hard rule 1) — so that branch stays proven only by
`test_llm_factory.py` and by code review of the (untouched) `if` arm.
"""

from __future__ import annotations

import llm.dependency as dependency_module
from llm.mock import MockLlmClient


def _reset_cached_client() -> None:
    dependency_module._client = None


def test_returns_mock_client_when_no_api_key_is_configured(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    _reset_cached_client()
    try:
        client = dependency_module.get_llm_client()
        assert isinstance(client, MockLlmClient)
    finally:
        _reset_cached_client()


def test_returns_mock_client_when_api_key_is_the_empty_string(monkeypatch):
    # Playwright's e2e harness sets ANTHROPIC_API_KEY="" explicitly so the
    # fixture-seeded api never picks up a real key from the developer's shell.
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    _reset_cached_client()
    try:
        client = dependency_module.get_llm_client()
        assert isinstance(client, MockLlmClient)
    finally:
        _reset_cached_client()


def test_client_is_cached_across_calls():
    dependency_module._client = MockLlmClient()
    try:
        assert dependency_module.get_llm_client() is dependency_module._client
    finally:
        _reset_cached_client()
