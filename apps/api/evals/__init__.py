"""Table Read LLM eval harness (build plan T6.1, test plan §3).

The `make evals` suite: real-API evals that gate every PROMPT_VERSION / model-id
change (CLAUDE.md hard rules 3 & 7). Four eval families ship here — schema
validity (per op), the lock-violation gate (rule 2, zero tolerance), continuity
adherence on the fixture, and segmentation determinism — plus the harness that
scores them, renders a rule-5-safe report artifact, and returns a nonzero exit
on any hard-gate failure.

**Hard rule 1 (never call the real API outside app startup / `make evals`).**
Importing any module here never opens a socket and never constructs the real
Anthropic client: the SDK/factory construction is deferred into `run.py`'s
entrypoint (mirroring `llm/factory.py` and `llm/dependency.py`). Every eval and
grader takes its client/judge by injection, so the harness's own test suite
(`tests/test_evals_*.py`) runs entirely on `MockLlmClient` / a mock judge behind
the conftest socket guard — the structural guarantee the controller runs the
real suite, not this build.

**Hard rule 5 (no writer text in logs/artifacts).** The report and every log
line carry only ids, hashes, token/attempt counts, scores, op names, and
PROMPT_VERSION — never fixture script/plan/fact text. `harness.assert_rule5_clean`
is a runtime choke point: `SuiteReport.write` invokes it against the
fixture-derived fragment set (`probes.fixture_text_fragments`) before any
artifact lands on disk, and self-tests cover both the leak and clean paths.
"""
