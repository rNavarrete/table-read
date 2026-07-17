"""`merge_story_overview` (T7.28 / beat-sheet grounding amendment): fold
`infer_story_overview` (InferredStoryOverview) into a project doc — see
`docs/superpowers/specs/2026-07-17-import-story-overview-design.md`.

Grounds outline/beat-sheet rows to real scene/beat ids (unknown ids dropped),
resolves `sceneId` and coerces `act` from the beat's parent scene, sorts and
dedupes the beat sheet, sets provenance inferred, and backfills empty
project/episode premises from the logline. Locked overview or locked episode
→ no-op.

No writer/import text is logged here (hard rule 5) — only ids and counts.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from schemas import InferredStoryOverview

_logger = logging.getLogger("drama_manager.overview")


def _find_episode(doc: dict, episode_id: str) -> dict:
    for season in doc.get("seasons") or []:
        for episode in season.get("episodes") or []:
            if episode["id"] == episode_id:
                return episode
    raise KeyError(episode_id)


def _scene_ids(episode: dict) -> set[str]:
    return {s["id"] for s in episode.get("scenes") or [] if s.get("id")}


def _beat_placement(episode: dict) -> dict[str, dict]:
    """Map beatId → {sceneId, act, sceneOrder, beatOrder} for grounding."""
    placement: dict[str, dict] = {}
    for scene_order, scene in enumerate(episode.get("scenes") or []):
        scene_id = scene.get("id")
        if not scene_id:
            continue
        act = scene.get("act")
        for beat_order, beat in enumerate(scene.get("beats") or []):
            beat_id = beat.get("id")
            if not beat_id:
                continue
            placement[beat_id] = {
                "sceneId": scene_id,
                "act": act if isinstance(act, int) and act >= 0 else None,
                "sceneOrder": scene_order,
                "beatOrder": beat_order,
            }
    return placement


def merge_story_overview(
    doc: dict, episode_id: str, result: InferredStoryOverview
) -> dict:
    """Mutate (and return) `doc`: attach `episode.storyOverview` and optionally
    backfill empty `doc.premise` / `episode.premise` from the logline.
    """
    episode = _find_episode(doc, episode_id)
    existing = episode.get("storyOverview")
    if episode.get("locked") or (isinstance(existing, dict) and existing.get("locked")):
        _logger.info(
            "merge_story_overview skipped locked episode_id=%s",
            episode_id,
        )
        return doc

    scenes = _scene_ids(episode)
    placement = _beat_placement(episode)
    outline: list[dict] = []
    dropped_outline = 0
    for item in result.outline:
        if item.scene_id not in scenes:
            dropped_outline += 1
            continue
        outline.append({"sceneId": item.scene_id, "summary": item.summary})

    beat_sheet: list[dict] = []
    dropped_beats = 0
    seen_beat_ids: set[str] = set()
    for item in result.beat_sheet:
        place = placement.get(item.beat_id)
        if place is None:
            dropped_beats += 1
            continue
        if item.beat_id in seen_beat_ids:
            dropped_beats += 1
            continue
        seen_beat_ids.add(item.beat_id)
        beat_sheet.append(
            {
                "beatId": item.beat_id,
                "label": item.label,
                "summary": item.summary,
                "sceneId": place["sceneId"],
                "act": place["act"],
                "_sceneOrder": place["sceneOrder"],
                "_beatOrder": place["beatOrder"],
            }
        )

    beat_sheet.sort(key=lambda r: (r["_sceneOrder"], r["_beatOrder"]))
    for row in beat_sheet:
        del row["_sceneOrder"]
        del row["_beatOrder"]

    overview = {
        "logline": result.logline,
        "outline": outline,
        "beatSheet": beat_sheet,
        "summary": result.summary,
        "provenance": "inferred",
        "locked": False,
    }
    episode["storyOverview"] = overview

    logline = (result.logline or "").strip()
    premise_filled = 0
    if logline:
        if not str(doc.get("premise") or "").strip():
            doc["premise"] = logline
            premise_filled += 1
        if not str(episode.get("premise") or "").strip():
            episode["premise"] = logline
            premise_filled += 1

    if dropped_outline or dropped_beats:
        _logger.info(
            "merge_story_overview outline_dropped=%d beat_sheet_dropped=%d",
            dropped_outline,
            dropped_beats,
        )
    _logger.info(
        "merge_story_overview outline=%d beat_sheet=%d premise_filled=%d",
        len(outline),
        len(beat_sheet),
        premise_filled,
    )
    return doc
