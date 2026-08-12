"""Run a blocking call under a wall-clock deadline, abandoning it if it overruns.

Used wherever a slow third party — the Anthropic SDK, Tesseract — can park a
thread for longer than we are willing to wait, and where the answer is to stop
waiting rather than to keep the process hostage.

**Why not `ThreadPoolExecutor`.** Its workers are non-daemon, and
`concurrent.futures` registers an atexit hook that joins them. So
`shutdown(wait=False)` does not skip the wait; it defers it to interpreter
shutdown. The caller returns promptly and the *process* then blocks on the call
it already gave up on. Measured: abandon a 5s call after 0.5s and the process
still takes 5.06s to exit; on a daemon thread it exits in 0.74s.

That gap is worst where it costs the most. An `make evals` suite would print
its report, say `exit=0`, and sit there — indistinguishable from a hang, and a
Ctrl-C there abandons a paid run.

**The abandoned work keeps running.** There is no cancellation here and none is
implied: `Future.cancel()` was already a no-op once a call had started, and
neither the Anthropic SDK nor Tesseract exposes a cooperative hook. The worker
runs to its own completion or its own timeout, writing into a dict nobody
reads. Callers holding resources the worker still touches must not free them on
the timeout path — see `fountain/pdf_extract.py`, which quarantines the pdfium
page rather than closing it out from under a live render.
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from typing import Any


class DeadlineExceeded(Exception):
    """The work did not finish inside its deadline and has been abandoned."""


def call_within_deadline(
    work: Callable[[], Any], timeout: float, *, name: str = "deadline-call"
) -> Any:
    """Run `work()` on a daemon thread, waiting at most `timeout` seconds.

    Returns its value, or re-raises whatever it raised, on the calling thread.
    Raises `DeadlineExceeded` if it is still running when the deadline passes;
    the thread is then abandoned and, being a daemon, cannot delay exit.
    """
    box: dict[str, Any] = {}

    def run() -> None:
        try:
            box["value"] = work()
        except BaseException as exc:  # noqa: BLE001 — re-raised on the caller's thread
            box["error"] = exc

    thread = threading.Thread(target=run, name=name, daemon=True)
    thread.start()
    thread.join(timeout)
    if thread.is_alive():
        raise DeadlineExceeded
    if "error" in box:
        raise box["error"]
    return box.get("value")
