"""LLM client layer (docs/tableread-prompt-spec.md; data contract §2a).

`protocol.py` defines the `LlmClient` Protocol shared by `mock.py`
(`MockLlmClient`, the only implementation any test may construct -- CLAUDE.md
hard rule 1) and `anthropic_client.py` (`AnthropicClient`, the real
Anthropic-backed implementation). `factory.py` is the only sanctioned place a
real `AnthropicClient` may be constructed (app startup / `make evals`).
`ops.py` is the single registry of Table Read's 8 LLM operations (the 7 §2a
tool schemas plus `BeatCandidate` from §2, reused by two ops) -- both client
implementations and `scripts/generate_tool_schemas.py` read from it.

This package builds no prompt beyond one fixed line: every method takes an
already-rendered `system` string and `user_message` string, and
`anthropic_client._ask_for_tool` appends a request to call the op's tool
(tool choice is `auto`; the 5.5 models reject a forced one). Editing that
line is a prompt change and bumps render.PROMPT_VERSION (hard rule 7).
Escaping freeform writer/import text into `<source_data>` blocks (prompt
spec §8b) is `drama_manager/render.py`'s job -- this layer is otherwise
Anthropic call mechanics (retry-once-then-surface, logging) only.
"""
