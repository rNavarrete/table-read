"""The import spending limit (T11.3): before each import unit starts, its
projected cost plus what the run has spent and what its in-flight units are
projected to cost must fit under the writer's `maxCostUsd`; otherwise the
unit raises `SpendLimitReached` before calling the model. Units already
running finish, so the run pauses at its last completed unit with every
checkpoint kept.

The projection is the wizard estimate's per-op shape
(`apps/web/src/projects/wizard/importCostEstimate.ts`, 0.51.0 calibration),
priced by `llm.costs`.
ponytail: a second copy of that shape; when T11.2 recalibrates the estimate,
move both onto one shared table.
"""

from __future__ import annotations

import math
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from types import SimpleNamespace

from llm import costs
from llm.ops import OP_REGISTRY, model_pins

# A unit is admitted on its "at most": the estimate's high end over its point.
AT_MOST = 1.35
# The estimate's entity chunk size (the server's own chunking varies).
_SCENES_PER_ENTITY_CHUNK = 10
_PER_SCENE = ("segmenting_beats", "extracting_facts")
_PREWARMED = ("segmenting_beats", "inferring_entities", "extracting_facts")


class SpendLimitReached(Exception):
    """A unit would take the run past its spending limit; nothing was sent."""


def unit_costs(scene_count: int, char_count: int) -> dict[str, float]:
    """Projected USD for one unit of each import stage (a `:prewarm` key for
    a stage's cache write), for a script of `scene_count` scenes and
    `char_count` characters. Token figures are the estimate's: the whole
    script as a cached prefix (3,000 + 0.6/char; the facts prefix 0.7/char),
    per-scene segment and facts calls, ~10-scene cast chunks, and one call
    each for acts, threads, motivations (threads' shape: the estimate
    predates it), overview and consistency."""
    n = scene_count
    pins = model_pins()
    script = round(3_000 + 0.6 * char_count)
    facts_prefix = round(3_000 + 0.7 * char_count)

    def cost(op: str, inp: float, out: float, *, read: int = 0, write: int = 0) -> float:
        usage = SimpleNamespace(
            input_tokens=round(inp),
            output_tokens=round(out),
            cache_read_input_tokens=read,
            cache_creation_input_tokens=write,
        )
        return costs.call_cost_usd(pins[OP_REGISTRY[op].role], usage) or 0.0

    threads = cost("infer_narrative_promises", 2_000 + 470 * n, 1_000 + 170 * n)
    return {
        "segmenting_beats": cost("segment_scene", 1_100, 750, read=script),
        "segmenting_beats:prewarm": cost("segment_scene", 1_100, 0, write=script),
        "inferring_acts": cost("infer_act_breaks", 2_000 + 420 * n, 800),
        "inferring_entities": cost("infer_story_entities", 4_600, 3_400, read=script),
        "inferring_entities:prewarm": cost("infer_story_entities", 4_600, 0, write=script),
        "inferring_promises": threads,
        "inferring_motivations": threads,
        "inferring_overview": cost("infer_story_overview", 2_000 + 940 * n, 500 + 90 * n),
        "extracting_facts": cost("extract_ledger_facts", 7_900, 900, read=facts_prefix),
        "extracting_facts:prewarm": cost("extract_ledger_facts", 7_900, 0, write=facts_prefix),
        "checking_consistency": cost("scan_consistency", 2_000 + 1_030 * n, 120 * n),
    }


class SpendLimit:
    """One run's limit over its `meter`. Thread-safe: units start on pool
    workers. `plan` must run once the scene split is known."""

    def __init__(self, meter: costs.CostMeter, max_cost_usd: float) -> None:
        self.meter = meter
        self.max_cost_usd = max_cost_usd
        self._lock = threading.Lock()
        self._reserved = 0.0
        self._scene_count = 0
        self._unit_costs: dict[str, float] = {}

    def plan(self, scene_count: int, char_count: int) -> None:
        self._scene_count = scene_count
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
        """About what the units not yet saved in `checkpoint` should cost
        (point estimate, prewarms included)."""
        n = self._scene_count
        planned = {
            "segmenting_beats": n,
            "inferring_acts": 1,
            "inferring_entities": math.ceil(n / _SCENES_PER_ENTITY_CHUNK),
            "inferring_promises": 1,
            "inferring_motivations": 1,
            "inferring_overview": 1,
            "extracting_facts": n,
            "checking_consistency": 1,
        }
        total = 0.0
        for stage, count in planned.items():
            saved = checkpoint.get(stage)
            if stage in _PER_SCENE or stage == "inferring_entities":
                done = len(saved) if isinstance(saved, dict) else 0
            else:
                done = 1 if saved else 0
            left = max(0, count - done)
            total += left * self._unit_costs.get(stage, 0.0)
            if stage in _PREWARMED and left >= 2:
                total += self._unit_costs.get(f"{stage}:prewarm", 0.0)
        return total


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
