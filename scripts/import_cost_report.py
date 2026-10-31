#!/usr/bin/env python3
"""What each import in an `import-diagnostics.log` cost, by run and by op (T11.2).

    python3 scripts/import_cost_report.py apps/api/logs/import-diagnostics.log

Reads only the `llm_call` / `llm_prewarm` token counts (plus each run's
`import_started` source_chars, parsing_scenes count and completion), prices
them from `config/llm_pricing.json` per model, and prints run ids, op names,
token totals and dollars — never writer text (hard rule 5).

Pricing per call: regular input, cache writes, cache reads and output (thinking
included, as billed). Haiku's long-prompt rates apply when a call's prompt
(input + cache write + cache read) is over `overPromptTokens`. Cache writes are
priced at the tier the line names (`cache_write_5m=` / `cache_write_1h=`);
a line with only `cache_write=` is priced at `--cache-ttl`, default 1h: every
import before T11.4 wrote the 1-hour tier. An unknown model is counted, never
guessed. Only logged responses count: the client before T11.1 logs a retried
call's second response alone, so its first attempt is missing from the total.

stdlib only, so it runs with any python3.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

PRICING_PATH = Path(__file__).resolve().parent.parent / "config" / "llm_pricing.json"
_KV = re.compile(r"(\w+)=(\S+)")
_EVENT = re.compile(
    r" (llm_call|llm_prewarm|import_started|import_found|import_completed|import_failed) "
)
_FIELDS = ("calls", "input", "cache_write", "cache_read", "output", "usd")


def _int(value: str | None) -> int:
    return int(value) if value and value.isdigit() else 0


def call_usd(pricing: dict, fields: dict[str, str], default_ttl: str) -> float | None:
    """One call's cost from its logged usage, or None for an unknown model."""
    rates = pricing["models"].get(fields.get("model", ""))
    if rates is None:
        return None
    tokens = {k: _int(fields.get(k)) for k in ("input_tokens", "output_tokens", "cache_read")}
    writes = {
        "5m": _int(fields.get("cache_write_5m")),
        "1h": _int(fields.get("cache_write_1h")),
    }
    if not any(writes.values()):
        writes[default_ttl] = _int(fields.get("cache_write"))
    prompt = tokens["input_tokens"] + tokens["cache_read"] + sum(writes.values())
    long = rates.get("longPrompt")
    if long and prompt > long["overPromptTokens"]:
        rates = long
    write_usd = (
        writes["5m"] * pricing["cacheWrite5mMultiplier"]
        + writes["1h"] * pricing["cacheWrite1hMultiplier"]
    ) * rates["inputUsdPerMTok"]
    return (
        tokens["input_tokens"] * rates["inputUsdPerMTok"]
        + write_usd
        + tokens["cache_read"] * rates["cacheReadUsdPerMTok"]
        + tokens["output_tokens"] * rates["outputUsdPerMTok"]
    ) / 1_000_000


def roll_up(lines, pricing: dict, default_ttl: str = "1h") -> dict[str, dict]:
    """{run_id: {"meta": {...}, "ops": {op: {calls, input, ..., usd}}, "unknown": n}}."""
    runs: dict[str, dict] = defaultdict(
        lambda: {
            "meta": {},
            "ops": defaultdict(lambda: dict.fromkeys(_FIELDS, 0)),
            "unknown": 0,
        }
    )
    for line in lines:
        event = _EVENT.search(line)
        if event is None:
            continue
        kind = event.group(1)
        fields = dict(_KV.findall(line))
        run_id = fields.get("run_id", "")
        if not run_id.startswith("import-"):
            continue
        run = runs[run_id]
        if kind == "import_started":
            run["meta"]["source_chars"] = _int(fields.get("source_chars"))
        elif kind == "import_found":
            if fields.get("stage") == "parsing_scenes" and fields.get("kind") == "scenes":
                run["meta"]["scenes"] = _int(fields.get("count"))
        elif kind in ("import_completed", "import_failed"):
            run["meta"]["status"] = kind.removeprefix("import_")
        else:
            usd = call_usd(pricing, fields, default_ttl)
            if usd is None:
                run["unknown"] += 1
                continue
            op = fields.get("op", "?") + (" (prewarm)" if kind == "llm_prewarm" else "")
            row = run["ops"][op]
            row["calls"] += 1
            row["input"] += _int(fields.get("input_tokens"))
            row["cache_write"] += _int(fields.get("cache_write"))
            row["cache_read"] += _int(fields.get("cache_read"))
            row["output"] += _int(fields.get("output_tokens"))
            row["usd"] += usd
    return runs


def report(runs: dict[str, dict]) -> str:
    out = []
    for run_id, run in runs.items():
        ops = run["ops"]
        if not ops:
            continue
        total = sum(row["usd"] for row in ops.values())
        meta = run["meta"]
        out.append(
            f"{run_id}  scenes={meta.get('scenes', '?')} "
            f"source_chars={meta.get('source_chars', '?')} "
            f"status={meta.get('status', 'incomplete')}  total ${total:.2f}"
        )
        out.append(
            f"  {'op':34}{'calls':>6}{'input':>10}{'cache_w':>10}{'cache_r':>11}"
            f"{'output':>9}{'$':>8}{'%':>6}"
        )
        for op, row in sorted(ops.items(), key=lambda item: -item[1]["usd"]):
            out.append(
                f"  {op:34}{row['calls']:>6}{row['input']:>10}{row['cache_write']:>10}"
                f"{row['cache_read']:>11}{row['output']:>9}{row['usd']:>8.2f}"
                f"{100 * row['usd'] / total if total else 0:>5.0f}%"
            )
        if run["unknown"]:
            out.append(f"  {run['unknown']} call(s) with an unknown model, not priced")
        out.append("")
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("log", type=Path)
    parser.add_argument("--pricing", type=Path, default=PRICING_PATH)
    parser.add_argument("--cache-ttl", choices=("1h", "5m"), default="1h")
    args = parser.parse_args(argv)
    pricing = json.loads(args.pricing.read_text())
    with args.log.open(encoding="utf-8", errors="replace") as lines:
        print(report(roll_up(lines, pricing, args.cache_ttl)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
