"""scripts/import_cost_report.py (T11.2): log in, cost per run and op out."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

_SCRIPTS = Path(__file__).resolve().parents[3] / "scripts"
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

import import_cost_report  # noqa: E402  (sys.path set up above)

PRICING = {
    "cacheWrite5mMultiplier": 1.25,
    "cacheWrite1hMultiplier": 2,
    "models": {
        "sonnet": {"inputUsdPerMTok": 2.0, "outputUsdPerMTok": 10.0, "cacheReadUsdPerMTok": 0.1},
        "haiku": {
            "inputUsdPerMTok": 0.1,
            "outputUsdPerMTok": 0.5,
            "cacheReadUsdPerMTok": 0.01,
            "longPrompt": {
                "overPromptTokens": 100000,
                "inputUsdPerMTok": 0.5,
                "outputUsdPerMTok": 2.5,
                "cacheReadUsdPerMTok": 0.05,
            },
        },
    },
}

RUN = "import-0000aaaa-1111-2222-3333-444455556666"


def _line(event: str, **fields: object) -> str:
    """Shaped like the real log: `<prefix> <event> key=value ...`."""
    return f"2026-10-30 10:00:00,000 INFO x {event} " + " ".join(
        f"{key}={value}" for key, value in fields.items()
    )


def _call(op: str, model: str, i: int, o: int, read: int, run: str = RUN) -> str:
    tokens = {"input_tokens": i, "output_tokens": o, "cache_write": 0, "cache_read": read}
    return _line("llm_call", op=op, run_id=run, model=model, **tokens)


# "Marta pours" stands in for writer text, which real lines never carry and
# the report must never print.
LOG = [
    _line("import_started", run_id=RUN, source_format="text", source_chars=4200),
    _line("import_found", run_id=RUN, stage="parsing_scenes", kind="scenes", count=3),
    _line("llm_prewarm", op="segment_scene", run_id=RUN, model="sonnet", cache_write=1_000_000),
    _call("segment_scene", "sonnet", 1_000_000, 100_000, 1_000_000) + " note=Marta pours",
    _call("scan_consistency", "haiku", 50_000, 10_000, 60_000),
    _call("extract_ledger_facts", "haiku", 50_000, 10_000, 40_000),
    _call("infer_story_overview", "mystery", 10, 10, 0),
    _line("segment_repair", scene_id="scene-1", text="Marta pours"),
    _call("check_structure", "sonnet", 999, 999, 0, run="None"),
    _line("import_completed", run_id=RUN, project="proj-1"),
]


def _ops(default_ttl: str = "1h") -> dict:
    runs = import_cost_report.roll_up(LOG, PRICING, default_ttl)
    assert list(runs) == [RUN]  # run_id=None (not an import) is left out
    return runs[RUN]


def test_prices_each_call_from_its_model():
    ops = _ops()["ops"]
    # $2 input + $1 output + $0.10 cache read
    assert ops["segment_scene"]["usd"] == pytest.approx(3.10)
    # 1M cache-write tokens at Sonnet's input rate, 1-hour tier by default
    assert ops["segment_scene (prewarm)"]["usd"] == pytest.approx(4.00)


def test_haiku_long_prompt_tier_over_the_threshold():
    ops = _ops()["ops"]
    # 110K-token prompt: every rate at the long tier
    assert ops["scan_consistency"]["usd"] == pytest.approx(0.053)
    # 90K-token prompt: regular rates
    assert ops["extract_ledger_facts"]["usd"] == pytest.approx(0.0104)


def test_cache_tier_from_flag_or_line():
    assert _ops("5m")["ops"]["segment_scene (prewarm)"]["usd"] == pytest.approx(2.50)
    fields = {"model": "sonnet", "cache_write": "1000", "cache_write_5m": "1000000"}
    assert import_cost_report.call_usd(PRICING, fields, "1h") == pytest.approx(2.50)


def test_unknown_model_is_counted_not_guessed():
    run = _ops()
    assert run["unknown"] == 1
    assert "infer_story_overview" not in run["ops"]


def test_report_prints_totals_and_never_writer_text(tmp_path, capsys):
    log = tmp_path / "import-diagnostics.log"
    log.write_text("\n".join(LOG))
    pricing = tmp_path / "pricing.json"
    pricing.write_text(json.dumps(PRICING))
    assert import_cost_report.main([str(log), "--pricing", str(pricing)]) == 0
    out = capsys.readouterr().out
    assert f"{RUN}  scenes=3 source_chars=4200 status=completed  total $7.16" in out
    assert "1 call(s) with an unknown model" in out
    assert "Marta" not in out
