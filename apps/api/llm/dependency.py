"""FastAPI dependency that provides the `LlmClient` to LLM-backed routes.

In production the real `AnthropicClient` is built lazily on first use and
cached (the only sanctioned construction point stays `llm/factory.py`, called
from here). Tests never hit this path: they override the dependency with a
`MockLlmClient` via `app.dependency_overrides[get_llm_client]`, so
`build_anthropic_client` (and therefore the `anthropic` SDK / the network) is
never reached — the conftest socket guard would fire if it were.

The `factory` import is deferred into the function body so importing this
module (and thus `routes`/`main`) never imports the `anthropic` SDK at import
time — matching the reasoning in `llm/factory.py`'s header.
"""

from __future__ import annotations

from llm.protocol import LlmClient

_client: LlmClient | None = None


def get_llm_client() -> LlmClient:
    global _client
    if _client is None:
        from llm.factory import build_anthropic_client

        _client = build_anthropic_client()
    return _client
