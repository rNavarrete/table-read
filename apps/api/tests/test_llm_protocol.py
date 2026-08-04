"""LlmClient Protocol conformance -- both implementations structurally
satisfy the same interface (data contract §2a acceptance: "all ops callable
against mock")."""

from llm.mock import MockLlmClient
from llm.protocol import LlmClient


def test_mock_client_satisfies_the_protocol():
    assert isinstance(MockLlmClient(), LlmClient)


def test_anthropic_client_satisfies_the_protocol():
    # Constructed with a bare object stand-in for the SDK client -- this test
    # never touches apps/api/llm/factory.py, so no real anthropic.Anthropic()
    # is built and no network is possible (CLAUDE.md hard rule 1).
    from llm.anthropic_client import AnthropicClient

    client = AnthropicClient(
        sdk_client=object(),
        models={
            "writer": "x",
            "classifier": "y",
            "import_worker": "w",
            "import_analyst": "z",
        },
    )
    assert isinstance(client, LlmClient)
