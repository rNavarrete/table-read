"""Server-Sent Events framing (data contract §4 generation stream).

A named SSE frame is `event: <name>\\n` + `data: <json>\\n\\n`. `data` is a
single JSON line (no embedded newlines — `json.dumps` default escapes them and
keeps ASCII, so the payload is always a safe single line and never carries a
lone surrogate into the response bytes).
"""

from __future__ import annotations

import json
from typing import Any


def format_sse(event: str, data: Any) -> str:
    """One SSE frame: an `event:` line and a single-line JSON `data:` payload."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"
