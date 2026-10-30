"""The import spending limit (T11.3): before each import unit starts, its
projected cost plus what the run has spent and what its in-flight units are
projected to cost must fit under the writer's `maxCostUsd`; otherwise the
unit raises `SpendLimitReached` before calling the model. Units already
running finish, so the run pauses at its last completed unit with every
checkpoint kept.

The projection is `config/import_cost_model.json`, the per-op model the
wizard's estimate evaluates too (`importCostEstimate.ts`), the same way, and
priced by `llm.costs`; a parity test pins the two to the cent.
"""

from __future__ import annotations

import json
import math
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from types import SimpleNamespace
from typing import Literal

from llm import costs
from llm.ops import model_pins

COST_MODEL = json.loads(
    (Path(__file__).resolve().parents[3] / "config" / "import_cost_model.json").read_text()
)
# A unit is admitted on its "at most": the estimate's high end over its point.
AT_MOST = COST_MODEL["range"]["high"]


class SpendLimitReached(Exception):
    """A unit would take the run past its spending limit; nothing was sent."""


def _tokens(linear: dict, n: int, c: int) -> float:
    """base + perScene*N + perChar*C + perCharPerScene*(C/N)."""
    return (
        linear.get("base", 0)
        + linear.get("perScene", 0) * n
        + linear.get("perChar", 0) * c
        + linear.get("perCharPerScene", 0) * (c / n)
    )


def entity_chunks(n: int, c: int) -> int:
    rule = COST_MODEL["entityChunks"]
    return max(
        math.ceil(n / rule["maxScenes"]),
        math.ceil(_tokens(rule["summaryChars"], n, c) / rule["charsPerChunk"]),
    )


def _calls(op: dict, n: int, c: int) -> int:
    return {"scene": n, "chunk": entity_chunks(n, c), "one": 1}[op["calls"]]


def unit_costs(
    scene_count: int, char_count: int, *, cache_write: Literal["5m", "1h"] = "5m"
) -> dict[str, float]:
    """Projected USD for one call of each import stage, keyed by stage, plus
    a `<stage>:prewarm` key for a stage's prefix write, for a script of
    `scene_count` scenes and `char_count` characters."""
    n, c = max(scene_count, 1), char_count
    pins = model_pins()

    def cost(role: str, inp: float, write: float, read: float, out: float) -> float:
        usage = SimpleNamespace(
            input_tokens=inp,
            cache_creation_input_tokens=write,
            cache_read_input_tokens=read,
            output_tokens=out,
        )
        return costs.call_cost_usd(pins[role], usage, cache_write=cache_write) or 0.0

    units: dict[str, float] = {}
    for op in COST_MODEL["ops"].values():
        shape = COST_MODEL["prefixes"].get(op.get("cachedPrefix"))
        prefix = _tokens(shape, n, c) if shape else 0.0
        units[op["stage"]] = cost(
            op["role"], _tokens(op["input"], n, c), 0, prefix, _tokens(op["output"], n, c)
        )
        if op.get("prewarm"):
            units[f"{op['stage']}:prewarm"] = cost(op["role"], 0, prefix, 0, 0)
    return units


def projected_usd(
    scene_count: int,
    char_count: int,
    checkpoint: dict | None = None,
    *,
    cache_write: Literal["5m", "1h"] = "5m",
) -> float:
    """About what an import's units not yet saved in `checkpoint` should
    cost (all of them without one: the wizard estimate's `about`): the cost
    model's point estimate, a stage's prewarm included while 2+ of its calls
    are left (the pipeline's rule)."""
    n, c, saved = max(scene_count, 1), char_count, checkpoint or {}
    units = unit_costs(n, c, cache_write=cache_write)
    total = 0.0
    for op in COST_MODEL["ops"].values():
        stage = op["stage"]
        if op["calls"] == "one":
            done = 1 if saved.get(stage) else 0
        else:
            done = len(saved[stage]) if isinstance(saved.get(stage), dict) else 0
        left = max(0, _calls(op, n, c) - done)
        total += left * units[stage]
        if op.get("prewarm") and left >= 2:
            total += units[f"{stage}:prewarm"]
    return total


class SpendLimit:
    """One run's limit over its `meter`. Thread-safe: units start on pool
    workers. `plan` must run once the scene split is known."""

    def __init__(self, meter: costs.CostMeter, max_cost_usd: float) -> None:
        self.meter = meter
        self.max_cost_usd = max_cost_usd
        self._lock = threading.Lock()
        self._reserved = 0.0
        self._scene_count = 0
        self._char_count = 0
        self._unit_costs: dict[str, float] = {}

    def plan(self, scene_count: int, char_count: int) -> None:
        self._scene_count = scene_count
        self._char_count = char_count
        self._unit_costs = unit_costs(scene_count, char_count)

    def _need(self, stage: str, prewarm: bool) -> float:
        need = self._unit_costs.get(stage, 0.0)
        if prewarm:
            # A prewarm only pays off if the first unit after it can start too.
            need += self._unit_costs.get(f"{stage}:prewarm", 0.0)
        return AT_MOST * need

    @contextmanager
    def admit(self, stage: str, *, prewarm: bool = False) -> Iterator[None]:
        """Admit one unit of `stage`, holding its projected cost until it ends
        (by then its real cost is on the meter), or raise SpendLimitReached."""
        need = self._need(stage, prewarm)
        with self._lock:
            if self.meter.spent_usd + self._reserved + need > self.max_cost_usd:
                raise SpendLimitReached(stage)
            self._reserved += need
        try:
            yield
        finally:
            with self._lock:
                self._reserved -= need

    def remaining_usd(self, checkpoint: dict) -> float:
        """About what the units not yet saved in `checkpoint` should cost."""
        return projected_usd(self._scene_count, self._char_count, checkpoint)


_limit: ContextVar[SpendLimit | None] = ContextVar("import_spend_limit", default=None)


@contextmanager
def limiting(limit: SpendLimit | None) -> Iterator[None]:
    """Hold every import unit started inside (they copy this context) to
    `limit`; None means no limit."""
    token = _limit.set(limit)
    try:
        yield
    finally:
        _limit.reset(token)


def current_limit() -> SpendLimit | None:
    return _limit.get()
