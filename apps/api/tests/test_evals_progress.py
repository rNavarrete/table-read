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


def test_schema_progress_emitted_before_llm_call_returns():
    """Hang illusion fix: operators must see run=i/n *before* a slow call blocks."""
    from evals import checks
    from evals.probes import load_fixture_ctx
    from llm.mock import MockLlmClient

    order: list[str] = []

    class OrderingClient(MockLlmClient):
        def generate_beat_candidates(self, **kwargs):
            order.append("call:generate_beat_candidates")
            return super().generate_beat_candidates(**kwargs)

    def on_progress(**kw):
        if kw.get("probe") == "generate_beat_candidates" and kw.get("status") == "running":
            order.append("progress:running")

    checks.schema_validity_eval(
        OrderingClient(), load_fixture_ctx(), runs=1, on_progress=on_progress
    )
    assert order.index("progress:running") < order.index("call:generate_beat_candidates")
