"""`merge_story_overview` (T7.28): fold `infer_story_overview`
(InferredStoryOverview) into a project doc — see
`docs/superpowers/specs/2026-07-17-import-story-overview-design.md`.

Grounds outline/beat-sheet rows to real scene/beat ids (unknown ids dropped),
sets provenance inferred, and backfills empty project/episode premises from
the logline. Locked overview or locked episode → no-op.

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


def _beat_ids(episode: dict) -> set[str]:
    ids: set[str] = set()
    for scene in episode.get("scenes") or []:
        for beat in scene.get("beats") or []:
            bid = beat.get("id")
            if bid:
                ids.add(bid)
    return ids


def _scene_ids(episode: dict) -> set[str]:
    return {s["id"] for s in episode.get("scenes") or [] if s.get("id")}


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
    beats = _beat_ids(episode)
    outline: list[dict] = []
    dropped_outline = 0
    for item in result.outline:
        if item.scene_id not in scenes:
            dropped_outline += 1
            continue
        outline.append({"sceneId": item.scene_id, "summary": item.summary})

    beat_sheet: list[dict] = []
    dropped_beats = 0
    for item in result.beat_sheet:
        if item.beat_id not in beats:
            dropped_beats += 1
            continue
        scene_id = item.scene_id if item.scene_id in scenes else None
        beat_sheet.append(
            {
                "beatId": item.beat_id,
                "label": item.label,
                "summary": item.summary,
                "sceneId": scene_id,
            }
        )

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
