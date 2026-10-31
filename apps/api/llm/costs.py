"""What model calls cost (T11.1): one pricing source over
`config/llm_pricing.json` (the table the wizard's estimate reads too), and the
meter an import run adds every billed call to.

Numbers only: nothing here sees prompt or response text (hard rule 5).
"""

from __future__ import annotations

import copy
import json
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from typing import Any, Literal

from import_diagnostics import current_import_unit

PRICING = json.loads(
    (Path(__file__).resolve().parents[3] / "config" / "llm_pricing.json").read_text()
)

# usage attribute (the Messages API's names) -> the meter's per-stage field
_USAGE_FIELDS = {
    "input_tokens": "inputTokens",
    "cache_creation_input_tokens": "cacheWriteTokens",
    "cache_read_input_tokens": "cacheReadTokens",
    "output_tokens": "outputTokens",
}


def _count(usage: Any, name: str) -> int:
    value = getattr(usage, name, None)
    return value if isinstance(value, int) else 0


def cache_writes(usage: Any, default: Literal["5m", "1h"] = "5m") -> tuple[int, int]:
    """`(5-minute, 1-hour)` cache-write tokens: the API's own split
    (`usage.cache_creation`) when the usage carries one, else every write at
    `default`, the tier the request sent (the 5-minute form since T11.4)."""
    split = getattr(usage, "cache_creation", None)
    five = getattr(split, "ephemeral_5m_input_tokens", None)
    hour = getattr(split, "ephemeral_1h_input_tokens", None)
    if isinstance(five, int) or isinstance(hour, int):
        return (five if isinstance(five, int) else 0, hour if isinstance(hour, int) else 0)
    total = _count(usage, "cache_creation_input_tokens")
    return (total, 0) if default == "5m" else (0, total)


def call_cost_usd(
    model: str, usage: Any, *, cache_write: Literal["5m", "1h"] = "5m"
) -> float | None:
    """What one call cost in USD, from its model id and `usage`: regular input,
    cache writes at their tier (`cache_writes`; `cache_write` is the tier
    assumed when the usage doesn't say), cache reads, and output (thinking
    included, as billed). A model with a `longPrompt` tier (Haiku) is priced
    at those rates when the prompt (input + cache write + cache read) is over
    `overPromptTokens`. None for a model the table doesn't price: unknown,
    never guessed."""
    rates = PRICING["models"].get(model)
    if rates is None:
        return None
    tokens = {name: _count(usage, name) for name in _USAGE_FIELDS}
    five, hour = cache_writes(usage, cache_write)
    long_prompt = rates.get("longPrompt")
    prompt = tokens["input_tokens"] + five + hour + tokens["cache_read_input_tokens"]
    if long_prompt is not None and prompt > long_prompt["overPromptTokens"]:
        rates = long_prompt
    write_rate = rates["inputUsdPerMTok"]
    return (
        tokens["input_tokens"] * rates["inputUsdPerMTok"]
        + five * write_rate * PRICING["cacheWrite5mMultiplier"]
        + hour * write_rate * PRICING["cacheWrite1hMultiplier"]
        + tokens["cache_read_input_tokens"] * rates["cacheReadUsdPerMTok"]
        + tokens["output_tokens"] * rates["outputUsdPerMTok"]
    ) / 1_000_000


def cost_field(cost: float | None) -> str:
    """A cost for a log line: dollars to six places, or `unknown`."""
    return "unknown" if cost is None else f"{cost:.6f}"


class CostMeter:
    """What one import run has spent, in all and by stage. Thread-safe: the
    import fans out. Built from a previous attempt's `snapshot()`, a resumed
    run keeps counting from where it stopped. A call whose cost is unknown
    counts its tokens and `unpricedCalls`, never a guessed price."""

    def __init__(self, saved: dict | None = None) -> None:
        saved = saved or {}
        self._lock = threading.Lock()
        self._spent = float(saved.get("importCostUsd") or 0.0)
        self._unpriced = int(saved.get("unpricedCalls") or 0)
        self._stages: dict[str, dict] = copy.deepcopy(saved.get("stages") or {})

    @property
    def spent_usd(self) -> float:
        with self._lock:
            return self._spent

    def add(self, stage: str, cost: float | None, usage: Any) -> None:
        with self._lock:
            row = self._stages.setdefault(
                stage, {"costUsd": 0.0, "calls": 0, **dict.fromkeys(_USAGE_FIELDS.values(), 0)}
            )
            row["calls"] += 1
            for name, field in _USAGE_FIELDS.items():
                row[field] += _count(usage, name)
            if cost is None:
                self._unpriced += 1
            else:
                self._spent += cost
                row["costUsd"] += cost

    def snapshot(self) -> dict:
        """The run's stored cost: `importCostUsd`, `unpricedCalls` and the
        per-stage totals (`costUsd`, `calls` and token counts)."""
        with self._lock:
            return {
                "importCostUsd": self._spent,
                "unpricedCalls": self._unpriced,
                "stages": copy.deepcopy(self._stages),
            }


_meter: ContextVar[CostMeter | None] = ContextVar("import_cost_meter", default=None)


@contextmanager
def metering(meter: CostMeter) -> Iterator[None]:
    """Add every call made inside (and in import units started inside, which
    copy this context) to `meter`."""
    token = _meter.set(meter)
    try:
        yield
    finally:
        _meter.reset(token)


def record_call(cost: float | None, usage: Any) -> None:
    """Add one billed call to the current import run's meter, under the
    stage of the import unit that made it; a no-op outside an import."""
    meter = _meter.get()
    if meter is not None:
        unit = current_import_unit()
        meter.add("-" if unit is None else unit.stage, cost, usage)
