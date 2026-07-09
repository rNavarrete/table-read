"""`build_anthropic_client()` -- the only sanctioned place a real
`AnthropicClient` may be constructed (CLAUDE.md hard rule 1: "The real client
is constructed only in app startup and `make evals`"). Call this from
`main.py`'s startup path or from `make evals` tooling. Never call it from a
test -- tests inject a fake/stub `sdk_client` directly into `AnthropicClient`
(see tests/test_llm_anthropic_client.py) and never import this module.

Not wired into `main.py` yet: no route in this codebase consumes an
`LlmClient` yet (T1.2 is clients + protocol + tool schemas + tests only, per
the task brief -- no endpoints). Wiring this into `main.py` now would mean
either constructing it eagerly at import time (breaking every test that
imports `main` whenever `ANTHROPIC_API_KEY` is unset -- exactly the landmine
hard rule 1 exists to prevent) or inventing a lazy-dependency pattern with no
consumer yet to validate it against. The first task that adds an LLM-backed
route should call this from app startup (or a FastAPI dependency) at that
point.
"""

from __future__ import annotations

import os
import tomllib
from pathlib import Path

import anthropic

from llm.anthropic_client import AnthropicClient

_MODELS_CONFIG_PATH = Path(__file__).resolve().parents[3] / "config" / "models.toml"


def _load_model_roles() -> dict[str, str]:
    with _MODELS_CONFIG_PATH.open("rb") as f:
        config = tomllib.load(f)
    return config["models"]


def build_anthropic_client() -> AnthropicClient:
    """Reads `ANTHROPIC_API_KEY` from the environment and constructs the real
    Anthropic SDK client plus the model-role pins from config/models.toml.
    Raises `KeyError` immediately if the API key is unset -- fail fast at
    startup, not on the first request."""
    api_key = os.environ["ANTHROPIC_API_KEY"]
    sdk_client = anthropic.Anthropic(api_key=api_key)
    return AnthropicClient(sdk_client=sdk_client, models=_load_model_roles())
