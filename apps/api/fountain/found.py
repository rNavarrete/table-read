"""Payloads for the import board's `found` SSE frames (data contract §9.3).

Each builder is pure and returns the camelCase `data` dict for one
`ProjectImportFound` kind, from data the pipeline already holds: no LLM
calls, no DB access. Indexes are 0-based positions in the scene split. No
builder ever copies a beat's `scriptText`.
"""

from __future__ import annotations

import re
from collections import Counter

from fountain.characters import cues_from_scenes, resolve_character_id
from fountain.parse import ImportedBeat, SceneSpan
from schemas import LedgerExtraction

CAST_LIMIT = 12

# Same optional production scene number `parse._SLUGLINE_RE` allows ("17 ", "A12 ").
_SCENE_NUMBER_RE = re.compile(r"^\s*[A-Za-z]?\d+[A-Za-z]?\s+")


def _int_ext(slugline: str) -> str:
    head = _SCENE_NUMBER_RE.sub("", slugline).lstrip().upper()
    if head.startswith("INT") and not head.startswith(("INT./EXT", "INT/EXT")):
        return "int"
    if head.startswith("EXT") and not head.startswith(("EXT./INT", "EXT/INT")):
        return "ext"
    return "other"


def scenes_found(spans: list[SceneSpan]) -> dict:
    return {
        "kind": "scenes",
        "scenes": [
            {
                "index": index,
                "slugline": span.location,
                "lineCount": len(span.lines),
                "intExt": _int_ext(span.location),
            }
            for index, span in enumerate(spans)
        ],
    }


def scene_found(
    index: int, beats: list[ImportedBeat], reading: dict[str, str], failed: bool
) -> dict:
    return {
        "kind": "scene",
        "index": index,
        "beatCount": len(beats),
        "whatHappens": reading["whatHappens"],
        "failed": failed,
    }


def acts_found(format_dict: dict, scene_acts: list[int]) -> dict:
    return {"kind": "acts", "format": format_dict, "sceneActs": list(scene_acts)}


def cast_read_found(scene_indexes: list[int]) -> dict:
    return {"kind": "castRead", "sceneIndexes": list(scene_indexes)}


def cast_found(characters: list[dict], scene_docs: list[dict], shooting_script: bool) -> dict:
    """`sceneCount` is the number of scenes whose cues resolve to the character,
    with the whole script's shooting-script decision applied to every scene."""
    scene_counts = Counter(
        character_id
        for scene in scene_docs
        for character_id in {
            resolve_character_id(name, characters)
            for name in cues_from_scenes([scene], shooting_script=shooting_script)
        }
        if character_id is not None
    )
    rows = [{"name": c["name"], "sceneCount": scene_counts[c["id"]]} for c in characters]
    rows.sort(key=lambda row: -row["sceneCount"])
    return {"kind": "cast", "total": len(characters), "characters": rows[:CAST_LIMIT]}


def threads_found(threads: list[dict], scene_index_by_id: dict[str, int]) -> dict:
    return {
        "kind": "threads",
        "threads": [
            {
                "label": thread["label"],
                "status": thread["status"],
                "setupSceneIndex": scene_index_by_id.get(thread.get("setupSceneId")),
                "payoffSceneIndex": scene_index_by_id.get(thread.get("payoffSceneId")),
            }
            for thread in threads
        ],
    }


def overview_found(overview: dict, scene_index_by_id: dict[str, int]) -> dict:
    return {
        "kind": "overview",
        "logline": overview.get("logline") or "",
        "beatSheet": [
            {"label": item["label"], "sceneIndex": scene_index_by_id.get(item.get("sceneId"))}
            for item in overview.get("beatSheet") or []
        ],
    }


def facts_found(index: int, extraction: LedgerExtraction, failed: bool) -> dict:
    return {
        "kind": "facts",
        "index": index,
        "factCount": len(extraction.new_facts),
        "secretCount": sum(not fact.audience_knows for fact in extraction.new_facts),
        "failed": failed,
    }


def flags_found(flags: list[dict]) -> dict:
    severities = Counter(flag["severity"] for flag in flags)
    contradictions, tensions = severities["contradiction"], severities["tension"]
    return {
        "kind": "flags",
        "contradictions": contradictions,
        "tensions": tensions,
        "other": len(flags) - contradictions - tensions,
    }
