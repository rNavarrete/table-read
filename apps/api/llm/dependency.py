"""FastAPI dependency that provides the `LlmClient` to LLM-backed routes.

In production the real `AnthropicClient` is built lazily on first use and
cached (the only sanctioned construction point stays `llm/factory.py`, called
from here). Tests never hit this path: they override the dependency with a
`MockLlmClient` via `app.dependency_overrides[get_llm_client]`, so
`build_anthropic_client` (and therefore the `anthropic` SDK / the network) is
never reached — the conftest socket guard would fire if it were.

Dev-mode fallback (T2.3): `make dev` runs `uvicorn` directly (no test, so no
dependency override) with no `ANTHROPIC_API_KEY` set by default. Before this
fallback, that meant the first LLM-backed request crashed with a bare
`KeyError` from `factory.build_anthropic_client` — not even the contract's
error envelope, just a 500. A missing key now deterministically selects
`MockLlmClient` instead of attempting (and failing) to build the real client,
so `make dev`/Playwright e2e against the seeded fixture work without an API
key. This never fires under `make evals` or real usage, both of which export
`ANTHROPIC_API_KEY` (hard rule 1 stays intact: the real client is still only
constructed here or in evals tooling, never in a test).

The `factory` import is deferred into the function body so importing this
module (and thus `routes`/`main`) never imports the `anthropic` SDK at import
time — matching the reasoning in `llm/factory.py`'s header.
"""

from __future__ import annotations

import os

from llm.protocol import LlmClient

_client: LlmClient | None = None


def get_llm_client() -> LlmClient:
    global _client
    if _client is None:
        if os.environ.get("ANTHROPIC_API_KEY"):
            from llm.factory import build_anthropic_client

            _client = build_anthropic_client()
        else:
            from llm.mock import MockLlmClient

            _client = MockLlmClient()
    return _client
