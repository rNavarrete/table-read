"""`merge_story_overview` (T7.28 / content-quality amendment): fold
`infer_story_overview` (InferredStoryOverview) into a project doc — see
`docs/superpowers/specs/2026-07-17-import-story-overview-design.md`.

Grounds outline/beat-sheet rows to real scene/beat ids (unknown ids dropped),
resolves `sceneId` and coerces `act` from the beat's parent scene, sorts and
dedupes the beat sheet, soft-replaces location-theater outline/beat summaries
with segmented beat text when available (never invents anchors), sets
provenance inferred, and backfills empty premises from the logline. Locked
overview or locked episode → no-op.

No writer/import text is logged here (hard rule 5) — only ids and counts.
"""

from __future__ import annotations

import logging
import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from schemas import InferredStoryOverview

_logger = logging.getLogger("drama_manager.overview")

# Soft quality heuristics — prefer replacing with segmented beat text over
# dropping rows. Keep the list short; over-rejection hides real story.
_LOCATION_THEATER_PHRASES = (
    "becomes a space for",
    "raises the stakes",
    "deepens character",
    "action shifts to",
    "crucial confrontation",
    "final reversal or commitment",
    "final reversal",
    "character dynamics",
)


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


def _norm_text(value: str) -> str:
    text = (value or "").lower()
    text = re.sub(r"^(int\.|ext\.|i/e\.)\s*", "", text)
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _scene_location_map(episode: dict) -> dict[str, str]:
    return {
        s["id"]: str(s.get("location") or "")
        for s in episode.get("scenes") or []
        if s.get("id")
    }


def _scene_beat_what_happens(episode: dict) -> dict[str, str]:
    """sceneId → joined beat whatHappens (import-segmented story text)."""
    out: dict[str, str] = {}
    for scene in episode.get("scenes") or []:
        sid = scene.get("id")
        if not sid:
            continue
        parts = [
            str(b.get("whatHappens") or "").strip()
            for b in scene.get("beats") or []
            if str(b.get("whatHappens") or "").strip()
        ]
        if parts:
            out[sid] = " ".join(parts)
    return out


def _beat_what_happens_map(episode: dict) -> dict[str, str]:
    out: dict[str, str] = {}
    for scene in episode.get("scenes") or []:
        for beat in scene.get("beats") or []:
            bid = beat.get("id")
            what = str(beat.get("whatHappens") or "").strip()
            if bid and what:
                out[bid] = what
    return out


def is_location_theater(summary: str, location: str = "") -> bool:
    """True when a summary mostly restates a location or known empty templates.

    Conservative: only flag clear location-paraphrase / boilerplate — never
    invent replacement text here (callers fall back to segmented beats).
    """
    summary_n = _norm_text(summary)
    if not summary_n:
        return True
    for phrase in _LOCATION_THEATER_PHRASES:
        if phrase in summary_n:
            return True
    loc_n = _norm_text(location)
    if not loc_n:
        return False
    loc_tokens = [t for t in loc_n.split() if len(t) > 2]
    if not loc_tokens:
        return False
    sum_tokens = summary_n.split()
    if len(sum_tokens) > 18:
        return False
    overlap = sum(1 for t in sum_tokens if t in set(loc_tokens))
    # Short summary dominated by location tokens → location theater.
    if len(sum_tokens) <= 12 and overlap / max(len(sum_tokens), 1) >= 0.45:
        return True
    # Summary is essentially the location plus a tiny filler clause.
    if loc_n in summary_n and len(sum_tokens) <= len(loc_tokens) + 4:
        return True
    return False


def _prefer_concrete(summary: str, fallback: str, location: str = "") -> str:
    """Keep LLM summary unless it is location theater and fallback is concrete."""
    fallback = (fallback or "").strip()
    if not is_location_theater(summary, location):
        return summary
    if fallback and not is_location_theater(fallback, location):
        return fallback
    return summary


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
    locations = _scene_location_map(episode)
    scene_whats = _scene_beat_what_happens(episode)
    beat_whats = _beat_what_happens_map(episode)

    outline: list[dict] = []
    dropped_outline = 0
    replaced_outline = 0
    for item in result.outline:
        if item.scene_id not in scenes:
            dropped_outline += 1
            continue
        location = locations.get(item.scene_id, "")
        summary = _prefer_concrete(
            item.summary, scene_whats.get(item.scene_id, ""), location
        )
        if summary != item.summary:
            replaced_outline += 1
        outline.append({"sceneId": item.scene_id, "summary": summary})

    beat_sheet: list[dict] = []
    dropped_beats = 0
    replaced_beats = 0
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
        location = locations.get(place["sceneId"], "")
        summary = _prefer_concrete(
            item.summary, beat_whats.get(item.beat_id, ""), location
        )
        if summary != item.summary:
            replaced_beats += 1
        beat_sheet.append(
            {
                "beatId": item.beat_id,
                "label": item.label,
                "summary": summary,
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

    if dropped_outline or dropped_beats or replaced_outline or replaced_beats:
        _logger.info(
            "merge_story_overview outline_dropped=%d beat_sheet_dropped=%d "
            "outline_replaced=%d beat_sheet_replaced=%d",
            dropped_outline,
            dropped_beats,
            replaced_outline,
            replaced_beats,
        )
    _logger.info(
        "merge_story_overview outline=%d beat_sheet=%d premise_filled=%d",
        len(outline),
        len(beat_sheet),
        premise_filled,
    )
    return doc
