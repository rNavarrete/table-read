"""Proves CLAUDE.md hard rule 1 for the LLM layer: no test path can
construct a real `AnthropicClient` or open a socket.

1. `build_anthropic_client` (the only sanctioned real-construction point) is
   never imported by any other test module in this suite.
2. `AnthropicClient.__init__` has no default that silently builds a real SDK
   client -- both `sdk_client` and `models` are required positional/keyword
   args.
3. A real network attempt from this process is blocked outright (belt and
   suspenders: even if some future test tried to reach the network, it
   would fail loudly here rather than silently placing a real call).
"""

from __future__ import annotations

import inspect
import socket
from pathlib import Path

import pytest


def test_build_anthropic_client_is_not_imported_by_any_other_test_module():
    tests_dir = Path(__file__).resolve().parent
    offenders = []
    for path in tests_dir.glob("test_*.py"):
        if path.name == "test_llm_factory.py":
            continue
        source = path.read_text()
        references_factory = (
            "build_anthropic_client" in source
            or "llm.factory" in source
            or "from llm import factory" in source
        )
        if references_factory:
            offenders.append(path.name)
    assert offenders == [], f"real-client factory referenced outside its own test: {offenders}"


def test_anthropic_client_requires_an_injected_sdk_client_and_models():
    from llm.anthropic_client import AnthropicClient

    with pytest.raises(TypeError):
        AnthropicClient()  # type: ignore[call-arg]


def test_anthropic_client_constructor_never_touches_the_anthropic_module():
    """Structural guard: AnthropicClient's own source has no reference to
    the `anthropic` package -- it only knows about an injected duck-typed
    `sdk_client`. Only llm/factory.py may import `anthropic` to build a real
    one."""
    import llm.anthropic_client as client_module

    assert "import anthropic" not in inspect.getsource(client_module)


def test_real_network_access_is_blocked_by_the_suite_wide_guard():
    """The suite-wide guard (tests/conftest.py) patches `socket.socket.connect`
    to raise for the duration of every test, so this fails loudly here rather
    than silently placing a real call. Uses a literal IP, not a hostname:
    `getaddrinfo` runs *before* the patched `connect`, so a hostname would
    make this test fail with `gaierror` in a no-DNS environment instead of
    exercising the guard -- a numeric address resolves locally, keeping the
    test hermetic."""
    with pytest.raises(AssertionError, match="network access attempted"):
        socket.create_connection(("1.1.1.1", 443), timeout=2)
