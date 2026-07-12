from __future__ import annotations

import time
from collections.abc import Callable
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

ProgressFn = Callable[..., None]


def emit_attempt(
    on_progress: ProgressFn | None,
    *,
    family: str,
    run: int,
    runs: int,
    probe: str | None = None,
    status: str = "running",
    elapsed: float | None = None,
) -> None:
    """Rule-5-safe attempt progress. Call with `status="running"` *before* an
    LLM call so a long request never looks hung after `family … status=start`."""
    if on_progress is None:
        return
    kw: dict[str, Any] = {
        "family": family,
        "run": run,
        "runs": runs,
        "status": status,
    }
    if probe is not None:
        kw["probe"] = probe
    if elapsed is not None:
        kw["elapsed"] = elapsed
    on_progress(**kw)


def format_progress_line(**kw: Any) -> str:
    parts = ["progress"]
    for key in ("family", "runs", "run", "probe", "status", "score", "gate", "elapsed"):
        if key not in kw:
            continue
        val = kw[key]
        if key == "run" and "runs" in kw:
            parts.append(f"run={val}/{kw['runs']}")
            continue
        if key == "runs" and "run" in kw:
            continue
        if key == "elapsed":
            elapsed = Decimal(str(val)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
            parts.append(f"elapsed={elapsed}s")
            continue
        if key == "gate" and val is None:
            val = "none"
        parts.append(f"{key}={val}")
    return " ".join(parts)


def make_stdout_progress(clock=time.monotonic) -> ProgressFn:
    def on_progress(**kw: Any) -> None:
        print(format_progress_line(**kw), flush=True)

    return on_progress
