"""T7.26 object custody / location continuity -- "simpler MVP" path from
the design doc (`docs/superpowers/specs/2026-07-16-time-aware-p1-remainder-
design.md` "T7.26 — Object custody / location continuity"): a deterministic
object-state table plus one deterministic conflict pass, no new LLM call.

`infer_object_states` reads text already produced by the existing
`extract_ledger_facts` call (state/event facts) rather than adding a new
classifier op or prompt change. It only recognizes one narrow, high-
precision phrasing (hidden/kept/stored/located in/at/under/behind) --
lightweight checks, not a full compiler (design doc). `holderCharacterId`
is always `None` in this cut: location is the only signal this pass reads;
a holder-tracking pass is future work the schema already has room for.
"""

from __future__ import annotations

import re

_LOCATION_RE = re.compile(
    r"^(?P<object>.+?)\s+(?:is|are|was|were)\s+"
    r"(?:hidden|kept|stored|located)\s+"
    r"(?:in|inside|at|under|behind)\s+"
    r"(?P<location>.+?)\.?$",
    re.IGNORECASE,
)

_LEADING_ARTICLE_RE = re.compile(r"^(the|a|an)\s+", re.IGNORECASE)


def infer_object_states(new_facts: list[dict]) -> list[dict]:
    """`ObjectState[]` (contract) for `new_facts` -- state/event facts
    whose text names an object's hiding/storage location."""
    states: list[dict] = []
    for fact in new_facts:
        if fact.get("factType") not in ("state", "event"):
            continue
        scene_id = (fact.get("sourceSpan") or {}).get("sceneId")
        text = (fact.get("fact") or "").strip()
        if not scene_id or not text:
            continue
        match = _LOCATION_RE.match(text)
        if not match:
            continue
        states.append(
            {
                "name": match["object"].strip(),
                "holderCharacterId": None,
                "locationLabel": match["location"].strip().rstrip("."),
                "sceneId": scene_id,
                "quote": text,
            }
        )
    return states


def _object_key(name: str) -> str:
    return _LEADING_ARTICLE_RE.sub("", name.strip()).casefold()


def detect_object_conflicts(states: list[dict], scenes: list[dict]) -> list[dict]:
    """Deterministic conflict pass (T7.26): flags a later `ObjectState`
    whose `locationLabel` disagrees with the same object's (name matched
    case/leading-article-insensitively) most recent earlier state, in
    scene order -- regardless of the input list's own order.

    Returns `ConsistencyFlag`-shaped dicts minus `id`/`status`/
    `sourceChange` (the caller mints/stamps those, same as every other
    import-time flag source in `analyze_import`). `severity: "tension"`,
    not `"contradiction"`: an object legitimately moving is common, so this
    is a review prompt, not an assertion of error.
    """
    scene_order = {scene["id"]: index for index, scene in enumerate(scenes)}
    by_object: dict[str, list[dict]] = {}
    for state in states:
        by_object.setdefault(_object_key(state["name"]), []).append(state)

    flags: list[dict] = []
    for group in by_object.values():
        ordered = sorted(
            group, key=lambda s: scene_order.get(s["sceneId"], len(scenes))
        )
        for previous, current in zip(ordered, ordered[1:]):
            if _object_key(previous["locationLabel"]) == _object_key(
                current["locationLabel"]
            ):
                continue
            flags.append(
                {
                    "objectType": "scene",
                    "objectId": current["sceneId"],
                    "factId": None,
                    "explanation": (
                        f"{current['name']} was last placed in "
                        f"\"{previous['locationLabel']}\" ({previous['sceneId']}) "
                        f"but this scene places it in \"{current['locationLabel']}\"."
                    ),
                    "severity": "tension",
                }
            )
    return flags
