"""FastAPI dependency that provides the `LlmClient` to LLM-backed routes.

In production the real `AnthropicClient` is built lazily on first use and
cached (the only sanctioned construction point stays `llm/factory.py`, called
from here). Tests never hit this path: they override the dependency with a
`MockLlmClient` via `app.dependency_overrides[get_llm_client]`, so
`build_anthropic_client` (and therefore the `anthropic` SDK / the network) is
never reached — the conftest socket guard would fire if it were.

Mock opt-in gate (T2.3 review): `make dev` and the Playwright e2e harness run
`uvicorn` directly (no test, so no dependency override) with no
`ANTHROPIC_API_KEY` set by default. Those paths use `MockLlmClient` — but the
mock is **opt-in via `TABLEREAD_ALLOW_MOCK_LLM=1`** (exported by the `make
dev` recipe and `apps/web/e2e/start-api.sh`), never a silent default: a
production deploy that merely forgot the key must not quietly serve canned
candidates and fabricated ledger facts that get snapshotted as real content.
When the key is absent and the flag is unset, the first LLM-backed request
gets a clear 503 `LLM_UNAVAILABLE` envelope naming both the missing key and
the flag. When the mock IS selected, a WARNING is logged (configuration
wording only — no writer text, hard rule 5). Hard rule 1 stays intact: the
real client is still only constructed here or in evals tooling, never in a
test.

The `factory` import is deferred into the function body so importing this
module (and thus `routes`/`main`) never imports the `anthropic` SDK at import
time — matching the reasoning in `llm/factory.py`'s header.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Callable
from typing import Literal

from errors import ApiError
from llm.protocol import LlmClient

_logger = logging.getLogger("llm.dependency")

MOCK_FLAG = "TABLEREAD_ALLOW_MOCK_LLM"

_client: LlmClient | None = None


def resolve_client_mode() -> Literal["real", "mock"]:
    """Decide which client the environment selects. Pure env inspection, no
    construction — split out so every arm (including "real", whose actual
    construction tests must never perform: hard rule 1 / the cross-test guard
    in tests/test_llm_factory.py) is unit-testable.

      - `ANTHROPIC_API_KEY` set (non-empty) → "real". The key always wins;
        the mock flag is ignored when a key is present.
      - no key, `TABLEREAD_ALLOW_MOCK_LLM=1` (exactly "1") → "mock".
      - neither → 503 `LLM_UNAVAILABLE` (the contract's error envelope, via
        the ApiError handler) naming both the missing key and the flag.
    """
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "real"
    if os.environ.get(MOCK_FLAG) == "1":
        return "mock"
    raise ApiError(
        503,
        "LLM_UNAVAILABLE",
        "the language model is unavailable: ANTHROPIC_API_KEY is not set. "
        f"Set ANTHROPIC_API_KEY, or set {MOCK_FLAG}=1 to explicitly opt in to "
        "the deterministic mock client (dev/e2e only — never production).",
    )


def get_llm_client_provider() -> Callable[[], LlmClient]:
    """A zero-arg *provider* of the `LlmClient`, for a route that needs the
    model only on some code paths — PATCH `/projects/{pid}`: a structural-field
    edit triggers `scan_consistency`, a plain field edit does not (data contract
    §4). Declaring `Depends(get_llm_client)` directly would resolve the client
    (and raise the 503-when-unconfigured) on *every* PATCH, including a title
    rename; injecting this provider defers that to the moment the route actually
    calls the model. Tests override THIS dependency to hand back a
    `lambda: MockLlmClient()` provider (hard rule 1)."""
    return get_llm_client


def get_llm_client() -> LlmClient:
    global _client
    if _client is None:
        if resolve_client_mode() == "real":
            from llm.factory import build_anthropic_client

            _client = build_anthropic_client()
        else:
            from llm.mock import MockLlmClient

            # Loud and unmissable in server logs; static configuration wording
            # only (hard rule 5 — no writer/script content exists here anyway).
            _logger.warning(
                "%s=1 and no ANTHROPIC_API_KEY: serving MockLlmClient "
                "(deterministic canned responses). This must never be a "
                "production configuration.",
                MOCK_FLAG,
            )
            _client = MockLlmClient()
    return _client
