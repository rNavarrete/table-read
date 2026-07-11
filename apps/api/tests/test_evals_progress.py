from __future__ import annotations

from evals.progress import format_progress_line


def test_format_progress_attempt_and_probe():
    assert format_progress_line(
        family="schema",
        run=2,
        runs=5,
        probe="tune_beat",
        elapsed=1.25,
    ) == "progress family=schema run=2/5 probe=tune_beat elapsed=1.3s"


def test_schema_eval_invokes_progress_per_probe_attempt():
    from evals import checks, probes
    from evals.probes import load_fixture_ctx
    from llm.mock import MockLlmClient

    events = []

    def on_progress(**kw):
        events.append(kw)

    checks.schema_validity_eval(
        MockLlmClient(), load_fixture_ctx(), runs=1, on_progress=on_progress
    )
    probes_seen = [e.get("probe") for e in events if e.get("probe")]
    assert set(probes_seen) == set(probes.SCHEMA_PROBES)
