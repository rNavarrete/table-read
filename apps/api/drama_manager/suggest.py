"""Instruction suggestion carousels (prompt spec §6, adoption A4).

Assembles a scene-aware context bundle (latest accepted beat script + scene
plan, plus optional unsaved draft script), calls `suggest_instructions`, and
deduplicates against `suggestion_history` (exact-text in MVP when embeddings
are absent; cosine when present). Persists accepted suggestions into history
so the next call can avoid near-duplicates.

No writer text is logged (hard rule 5): ids/counts/PROMPT_VERSION only.
"""

from __future__ import annotations

import logging
import uuid

from sqlalchemy.orm import Session

from drama_manager import candidates, render
from llm.protocol import LlmClient
from storage.models import SuggestionHistoryRow

_logger = logging.getLogger("drama_manager.suggest")

_MAX_RETRIES = 1


class SuggestTargetError(Exception):
    """Bad context/targetId combination."""


def _is_duplicate(text: str, history: list[SuggestionHistoryRow]) -> bool:
    lowered = text.strip().lower()
    if not lowered:
        return True
    for row in history:
        if (row.text or "").strip().lower() == lowered:
            return True
    return False


def _resolve_scene_id(doc: dict, context: str, target_id: str) -> tuple[str, str | None]:
    """Return (scene_id, after_beat_id) for context assembly."""
    if context == "scene":
        candidates.validate_target(doc, target_id, None)
        episode_scene = None
        for season in doc.get("seasons", []):
            for episode in season.get("episodes", []):
                for scene in episode.get("scenes", []):
                    if scene["id"] == target_id:
                        episode_scene = scene
                        break
        if episode_scene is None:
            raise SuggestTargetError(f"scene {target_id!r} not found")
        beats = episode_scene.get("beats", [])
        after = beats[-1]["id"] if beats else None
        return target_id, after

    if context == "beat":
        for season in doc.get("seasons", []):
            for episode in season.get("episodes", []):
                for scene in episode.get("scenes", []):
                    for beat in scene.get("beats", []):
                        if beat["id"] == target_id:
                            return scene["id"], target_id
        raise SuggestTargetError(f"beat {target_id!r} not found")

    raise SuggestTargetError(f"unknown context {context!r}")


def suggest_for_surface(
    session: Session,
    llm: LlmClient,
    *,
    project_id: str,
    doc: dict,
    ledger: list[dict],
    context: str,
    target_id: str,
    surface: str,
    draft_script: str | None = None,
) -> list[str]:
    """Return 3 suggestion strings; record them in suggestion_history."""
    scene_id, after_beat_id = _resolve_scene_id(doc, context, target_id)
    ctx = candidates._scene_context(
        doc, ledger, scene_id=scene_id, after_beat_id=after_beat_id
    )
    if draft_script and draft_script.strip():
        prior = ctx.get("previous_script") or ""
        ctx["previous_script"] = (
            f"{prior}\n\n{draft_script.strip()}".strip()
            if prior
            else draft_script.strip()
        )

    history = (
        session.query(SuggestionHistoryRow)
        .filter_by(project_id=project_id)
        .all()
    )

    suggestions: list[str] = []
    attempts = 0
    while attempts <= _MAX_RETRIES:
        attempts += 1
        nonce = render.new_nonce()
        system, user = render.build_suggest_prompt(
            doc, **ctx, surface=surface, nonce=nonce
        )
        result = llm.suggest_instructions(
            system=system,
            user_message=user,
            prompt_version=render.PROMPT_VERSION,
        )
        filtered = [
            s for s in result.suggestions if not _is_duplicate(s, history)
        ]
        if len(filtered) == 3:
            suggestions = filtered
            break
        # Keep best effort; one retry if any were duplicates.
        suggestions = list(result.suggestions)
        if attempts > _MAX_RETRIES:
            break

    _logger.info(
        "suggest_instructions project=%s scene=%s surface=%s count=%s PROMPT_VERSION=%s",
        project_id,
        scene_id,
        surface,
        len(suggestions),
        render.PROMPT_VERSION,
    )

    # Persist for future dedup (embeddings null until an embedder lands).
    for text in suggestions[:3]:
        session.add(
            SuggestionHistoryRow(
                id=f"sug-{uuid.uuid4().hex[:12]}",
                project_id=project_id,
                text=text,
                embedding=None,
            )
        )
    session.commit()
    # Pad/truncate to exactly 3 for the wire contract.
    while len(suggestions) < 3:
        suggestions.append(suggestions[-1] if suggestions else "Continue the scene.")
    return suggestions[:3]
