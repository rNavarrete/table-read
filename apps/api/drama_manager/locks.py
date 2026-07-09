"""Read-side lock filter (CLAUDE.md hard rule 2).

**Locks are sacred.** Any code path that regenerates content MUST route through
this filter. T2.1 (candidate generation) is read-only w.r.t. the doc — it needs
to know *which* content is locked so locked beat text can be surfaced to the
model as an immutable constraint (prompt spec §1 `locked_beats`), and so the
context bundle never proposes overwriting it.

This is the minimal read-side surface, designed to grow write-side enforcement
later (beat accept T2.2, change-set apply T4.2, import-as-replace T3.2):

  - `is_locked(doc, object_id)` — is this scene/beat locked, honoring the
    cascade below?
  - `locked_beats_in_scene(doc, scene_id)` — the locked beats (plan + script)
    to render as constraints.

**Cascade rules (test plan line 16):** a lock is inherited downward.
  - episode.locked  → every scene and beat under it is locked
  - scene.locked    → every beat in it is locked
  - beat.locked OR beat.scriptLocked → that beat is locked

`scriptLocked` (the beat's script text is frozen but its plan may move) counts
as locked for the read-side constraint surface: its scriptText is an immutable
constraint the model must land on, exactly like a fully locked beat.

Doc shapes are camelCase wire dicts (`Project`/`Scene`/`Beat`).
"""

from __future__ import annotations


def _iter_scenes(doc: dict):
    """Yield (episode, scene) for every scene in the project (MVP: one episode)."""
    for season in doc.get("seasons", []):
        for episode in season.get("episodes", []):
            for scene in episode.get("scenes", []):
                yield episode, scene


def _find(doc: dict, object_id: str) -> tuple[dict | None, dict | None, dict | None]:
    """Locate object_id, returning (episode, scene, beat) with whichever are
    relevant set and the rest None. Missing → all None."""
    for episode, scene in _iter_scenes(doc):
        if scene["id"] == object_id:
            return episode, scene, None
        for beat in scene.get("beats", []):
            if beat["id"] == object_id:
                return episode, scene, beat
    for season in doc.get("seasons", []):
        for episode in season.get("episodes", []):
            if episode["id"] == object_id:
                return episode, None, None
    return None, None, None


def _beat_is_locked(episode: dict, scene: dict, beat: dict) -> bool:
    return bool(
        episode.get("locked")
        or scene.get("locked")
        or beat.get("locked")
        or beat.get("scriptLocked")
    )


def is_locked(doc: dict, object_id: str) -> bool:
    """True if the scene/beat/episode `object_id` is locked, honoring the
    episode→scene→beat cascade. Unknown ids are treated as not locked (callers
    validate existence separately)."""
    episode, scene, beat = _find(doc, object_id)
    if beat is not None:
        return _beat_is_locked(episode, scene, beat)
    if scene is not None:
        return bool(episode.get("locked") or scene.get("locked"))
    if episode is not None:
        return bool(episode.get("locked"))
    return False


def locked_beats_in_scene(doc: dict, scene_id: str) -> list[dict]:
    """The locked beats of `scene_id`, as constraint records (plan + scriptText)
    for the candidate bundle (§1 `locked_beats`). Empty if the scene is absent
    or has no locked beats. A beat is included when it is locked by any cascade
    rule above (its own `locked`/`scriptLocked`, or its scene/episode lock)."""
    for episode, scene in _iter_scenes(doc):
        if scene["id"] != scene_id:
            continue
        return [
            {
                "beatId": beat["id"],
                "whatHappens": beat.get("whatHappens", ""),
                "audienceLearns": beat.get("audienceLearns", ""),
                "audienceFeels": beat.get("audienceFeels", ""),
                "scriptText": beat.get("scriptText", ""),
            }
            for beat in scene.get("beats", [])
            if _beat_is_locked(episode, scene, beat)
        ]
    return []
