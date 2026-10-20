"""`merge_story_overview` (T7.28 / content-quality + TV-label harden): fold
`infer_story_overview` (InferredStoryOverview) into a project doc — see
`docs/superpowers/specs/2026-07-17-import-story-overview-design.md`.

Grounds outline/beat-sheet rows to real scene/beat ids (unknown ids dropped),
resolves `sceneId` and coerces `act` from the beat's parent scene, normalizes
Tag/Cold Open acts and banned film labels to TV act vocabulary, sorts and
dedupes the beat sheet, soft-replaces location-theater or scene-mismatched
outline/beat summaries with segmented beat text when available (never invents
anchors), sets provenance inferred, and backfills empty premises from the
logline. Locked overview or locked episode → no-op.

T10.6 (breakdown ledgers P1 design): carries the About strings and each
outline row's story time, keeping `storyOrder` only when it reorders the
outline (`_keep_story_order`), and replaces `Episode.characterArcs` with the
resolved principals (`_merge_arcs`). The arcs follow the overview's lock.

No writer/import text is logged here (hard rule 5) — only ids and counts.
"""

from __future__ import annotations

import logging
import re
from collections import Counter
from typing import TYPE_CHECKING

from fountain.characters import resolve_character_id

if TYPE_CHECKING:
    from schemas import InferredCharacterArc, InferredStoryOverview

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

# Film / STC labels that must never ship as beat-sheet vocabulary.
_BANNED_FILM_LABELS = (
    "inciting incident",
    "midpoint",
    "climactic reversal",
    "act two opening",
    "opening image",
    "theme stated",
    "catalyst",
    "break into two",
    "fun and games",
    "bad guys close in",
    "all is lost",
    "dark night of the soul",
    "break into three",
    "final image",
)

_ACT_ORDINAL_WORDS = (
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
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


def summary_mismatches_scene(
    summary: str, scene_id: str, locations: dict[str, str]
) -> bool:
    """True when summary clearly names another scene's location over its own.

    Used to catch Tag (etc.) rows whose prose drifted to a different room
    than the beat's parent scene — prefer segmented whatHappens instead.
    """
    summary_n = _norm_text(summary)
    if not summary_n:
        return False
    own_n = _norm_text(locations.get(scene_id, ""))
    own_tokens = {t for t in own_n.split() if len(t) > 3}
    for other_id, other_loc in locations.items():
        if other_id == scene_id:
            continue
        other_n = _norm_text(other_loc)
        if not other_n or len(other_n) < 5:
            continue
        other_tokens = {t for t in other_n.split() if len(t) > 3} - own_tokens
        if not other_tokens:
            continue
        hits_other = sum(1 for t in other_tokens if t in summary_n.split())
        hits_own = sum(1 for t in own_tokens if t in summary_n.split())
        if other_n in summary_n and (not own_n or own_n not in summary_n):
            return True
        if hits_other >= 2 and hits_other > hits_own:
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


def _prefer_aligned(
    summary: str,
    fallback: str,
    *,
    scene_id: str,
    locations: dict[str, str],
    location: str,
) -> str:
    """Location-theater first, then scene-alignment vs other locations."""
    chosen = _prefer_concrete(summary, fallback, location)
    fallback = (fallback or "").strip()
    if (
        summary_mismatches_scene(chosen, scene_id, locations)
        and fallback
        and not summary_mismatches_scene(fallback, scene_id, locations)
    ):
        return fallback
    return chosen


def normalize_overview_newlines(text: str) -> str:
    """Collapse double-escaped newlines so synopsis paragraphs render."""
    if "\\" not in text:
        return text
    return (
        text.replace("\\r\\n", "\n")
        .replace("\\n", "\n")
        .replace("\\r", "\n")
        .replace("\\t", "\t")
    )


def is_banned_film_label(label: str) -> bool:
    norm = _norm_text(label)
    if not norm:
        return False
    return any(banned in norm for banned in _BANNED_FILM_LABELS)


def _is_tag_label(label: str) -> bool:
    return bool(re.search(r"\btag\b", label or "", flags=re.IGNORECASE))


def _is_cold_open_label(label: str) -> bool:
    return bool(
        re.search(r"\b(cold\s*open|teaser)\b", label or "", flags=re.IGNORECASE)
    )


def _act_turn_label(act: int | None, format_dict: dict) -> str:
    if act is None:
        return "Act Turn"
    if format_dict.get("coldOpen") and act == 0:
        return "Cold Open"
    ordinal = act if format_dict.get("coldOpen") else act + 1
    if 1 <= ordinal <= len(_ACT_ORDINAL_WORDS):
        return f"Act {_ACT_ORDINAL_WORDS[ordinal - 1]} Turn"
    return f"Act {ordinal} Turn"


def coerce_beat_label_and_act(
    label: str, act: int | None, format_dict: dict | None
) -> tuple[str, int | None]:
    """Normalize Tag/Cold Open acts and rewrite banned film labels.

    Tag (when format.tag): keep/force label \"Tag\", clear act so UI shows TAG
    rather than the last numeric act (e.g. ACT FOUR). Cold Open/Teaser (when
    coldOpen): force act 0. Banned film labels → Act N Turn when act known.
    """
    fmt = format_dict or {}
    cleaned = (label or "").strip() or "Act Turn"

    if _is_tag_label(cleaned) and fmt.get("tag"):
        return "Tag", None
    if _is_cold_open_label(cleaned) and fmt.get("coldOpen"):
        return cleaned, 0
    if is_banned_film_label(cleaned):
        return _act_turn_label(act, fmt), act
    return cleaned, act


_MAX_ARCS = 3


def _keep_story_order(outline: list[dict], scene_order: dict[str, int]) -> int:
    """Null every row's `storyOrder` unless the ranks are a permutation of
    0..n−1 over the outline rows that differs from script order — a partial
    or identity order is noise. `anachrony` is left alone. Returns how many
    ranks were nulled."""
    ranks = [row["storyOrder"] for row in outline]
    in_script_order = [
        row["storyOrder"] for row in sorted(outline, key=lambda r: scene_order[r["sceneId"]])
    ]
    identity = list(range(len(outline)))
    if None not in ranks and sorted(ranks) == identity and in_script_order != identity:
        return 0
    for row in outline:
        row["storyOrder"] = None
    return sum(rank is not None for rank in ranks)


def _merge_arcs(
    arcs: list[InferredCharacterArc],
    characters: list[dict],
    scene_order: dict[str, int],
    counts: Counter,
) -> list[dict]:
    """Resolve each arc's `characterName` (unresolved arcs dropped), keep the
    first arc per character and at most three; per arc, drop stops on unknown
    scenes or with no reading, keep one per scene (first wins), in scene
    order."""
    kept: list[dict] = []
    for arc in arcs:
        character_id = resolve_character_id(arc.character_name.strip(), characters)
        if character_id is None:
            counts["arcs_unresolved"] += 1
            continue
        if any(k["characterId"] == character_id for k in kept):
            counts["arcs_duplicate"] += 1
            continue
        if len(kept) == _MAX_ARCS:
            counts["arcs_over_cap"] += 1
            continue
        stops: dict[str, str] = {}
        for stop in arc.stops:
            known = stop.scene_id in scene_order and stop.scene_id not in stops
            if not known or not stop.head_at.strip():
                counts["stops_dropped"] += 1
                continue
            stops[stop.scene_id] = stop.head_at
        kept.append(
            {
                "characterId": character_id,
                "want": arc.want,
                "need": arc.need,
                "lie": arc.lie,
                "ghost": arc.ghost,
                "continuumAxis": arc.continuum_axis,
                "stops": [
                    {"sceneId": scene_id, "headAt": stops[scene_id]}
                    for scene_id in sorted(stops, key=scene_order.__getitem__)
                ],
            }
        )
    return kept


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
    format_dict = doc.get("format") if isinstance(doc.get("format"), dict) else {}

    outline: list[dict] = []
    dropped_outline = 0
    replaced_outline = 0
    for item in result.outline:
        if item.scene_id not in scenes:
            dropped_outline += 1
            continue
        location = locations.get(item.scene_id, "")
        summary = _prefer_aligned(
            item.summary,
            scene_whats.get(item.scene_id, ""),
            scene_id=item.scene_id,
            locations=locations,
            location=location,
        )
        if summary != item.summary:
            replaced_outline += 1
        outline.append(
            {
                "sceneId": item.scene_id,
                "summary": summary,
                "storyOrder": item.story_order,
                "storyTime": item.story_time,
                "anachrony": item.anachrony.value,
            }
        )

    beat_sheet: list[dict] = []
    dropped_beats = 0
    replaced_beats = 0
    rewritten_labels = 0
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
        summary = _prefer_aligned(
            item.summary,
            beat_whats.get(item.beat_id, ""),
            scene_id=place["sceneId"],
            locations=locations,
            location=location,
        )
        if summary != item.summary:
            replaced_beats += 1
        label, act = coerce_beat_label_and_act(
            item.label, place["act"], format_dict
        )
        if label != (item.label or "").strip() or act != place["act"]:
            # Count only vocabulary / module coercions (not mere act-from-scene).
            if label != (item.label or "").strip() or _is_tag_label(label):
                rewritten_labels += 1
        beat_sheet.append(
            {
                "beatId": item.beat_id,
                "label": label,
                "summary": summary,
                "sceneId": place["sceneId"],
                "act": act,
                "_sceneOrder": place["sceneOrder"],
                "_beatOrder": place["beatOrder"],
            }
        )

    beat_sheet.sort(key=lambda r: (r["_sceneOrder"], r["_beatOrder"]))
    for row in beat_sheet:
        del row["_sceneOrder"]
        del row["_beatOrder"]

    scene_order = {
        s["id"]: i for i, s in enumerate(episode.get("scenes") or []) if s.get("id")
    }
    arc_counts: Counter = Counter()
    arc_counts["story_order_nulled"] = _keep_story_order(outline, scene_order)
    characters = (doc.get("seriesBible") or {}).get("characters") or []
    arcs = _merge_arcs(result.character_arcs, characters, scene_order, arc_counts)

    overview = {
        "logline": result.logline,
        "outline": outline,
        "beatSheet": beat_sheet,
        "summary": normalize_overview_newlines(result.summary or ""),
        "dramaticQuestion": result.dramatic_question,
        "centralArgument": result.central_argument,
        "antiTheme": result.anti_theme,
        "provenance": "inferred",
        "locked": False,
    }
    episode["storyOverview"] = overview
    episode["characterArcs"] = arcs

    logline = (result.logline or "").strip()
    premise_filled = 0
    if logline:
        if not str(doc.get("premise") or "").strip():
            doc["premise"] = logline
            premise_filled += 1
        if not str(episode.get("premise") or "").strip():
            episode["premise"] = logline
            premise_filled += 1

    if (
        dropped_outline
        or dropped_beats
        or replaced_outline
        or replaced_beats
        or rewritten_labels
    ):
        _logger.info(
            "merge_story_overview outline_dropped=%d beat_sheet_dropped=%d "
            "outline_replaced=%d beat_sheet_replaced=%d labels_rewritten=%d",
            dropped_outline,
            dropped_beats,
            replaced_outline,
            replaced_beats,
            rewritten_labels,
        )
    _logger.info(
        "merge_story_overview outline=%d beat_sheet=%d premise_filled=%d",
        len(outline),
        len(beat_sheet),
        premise_filled,
    )
    _logger.info(
        "merge_story_overview arcs=%d stops=%d arcs_unresolved=%d "
        "arcs_duplicate=%d arcs_over_cap=%d stops_dropped=%d "
        "story_order_kept=%d story_order_nulled=%d anachronies=%d",
        len(arcs),
        sum(len(a["stops"]) for a in arcs),
        arc_counts["arcs_unresolved"],
        arc_counts["arcs_duplicate"],
        arc_counts["arcs_over_cap"],
        arc_counts["stops_dropped"],
        sum(row["storyOrder"] is not None for row in outline),
        arc_counts["story_order_nulled"],
        sum(row["anachrony"] != "none" for row in outline),
    )
    return doc
