"""Read-side lock filter (CLAUDE.md hard rule 2).

**Locks are sacred.** Any code path that regenerates content MUST route through
this filter. T2.1 (candidate generation) is read-only w.r.t. the doc — it needs
to know *which* content is locked so locked beat text can be surfaced to the
model as an immutable constraint (prompt spec §1 `locked_beats`), and so the
context bundle never proposes overwriting it.

This grew a write-side surface for beat accept (T2.2); change-set apply (T4.2)
and import-as-replace (T3.2) will extend it further:

  - `is_locked(doc, object_id)` — is this scene/beat locked, honoring the
    cascade below?
  - `locked_beats_in_scene(doc, scene_id)` — the locked beats (plan + script)
    to render as constraints.
  - `insert_beat(doc, scene_id, after_beat_id, new_beat)` — the *only* lock-safe
    beat-insertion path: rejects a locked scene/episode and guarantees no
    locked beat's content is ever modified (rule 2), returning a new doc.

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

import copy


class LockViolation(Exception):
    """A write path attempted to add to, or modify, locked content
    (CLAUDE.md rule 2). The route layer maps this to 409 ``LOCKED_OBJECT``."""

    code = "LOCKED_OBJECT"


# The beat fields that constitute *content* for the lock byte-identity
# guarantee. ``index`` is deliberately excluded: it is structural position, not
# content, so reindexing siblings around a locked beat is allowed (data contract
# §1 leaves `index` outside the lock's scope; see the T2.2 report).
_BEAT_CONTENT_FIELDS = (
    "id",
    "locked",
    "whatHappens",
    "audienceLearns",
    "audienceFeels",
    "scriptText",
    "scriptLocked",
)


def _iter_scenes(doc: dict):
    """Yield (episode, scene) for every scene in the project (MVP: one episode)."""
    for season in doc.get("seasons", []):
        for episode in season.get("episodes", []):
            for scene in episode.get("scenes", []):
                yield episode, scene


def _iter_beats(doc: dict):
    """Yield (episode, scene, beat) for every beat in the project."""
    for episode, scene in _iter_scenes(doc):
        for beat in scene.get("beats", []):
            yield episode, scene, beat


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


def _beat_content(beat: dict) -> dict:
    return {field: beat.get(field) for field in _BEAT_CONTENT_FIELDS}


def _assert_locked_content_unchanged(old_doc: dict, new_doc: dict) -> None:
    """Rule 2 guarantee: every beat that was locked in ``old_doc`` appears in
    ``new_doc`` with byte-identical *content* (``index`` may differ). A pure
    insertion never touches content, so this can only fire on a bug — it is the
    write path's belt-and-suspenders against silently rewriting locked material."""
    new_beats = {beat["id"]: beat for _episode, _scene, beat in _iter_beats(new_doc)}
    for episode, scene, beat in _iter_beats(old_doc):
        if not _beat_is_locked(episode, scene, beat):
            continue
        after = new_beats.get(beat["id"])
        if after is None or _beat_content(after) != _beat_content(beat):
            raise LockViolation(f"locked beat {beat['id']!r} content changed during a write")


def insert_beat(
    doc: dict, scene_id: str, after_beat_id: str | None, new_beat: dict
) -> dict:
    """Insert ``new_beat`` into ``scene_id`` after ``after_beat_id`` (or at the
    top of the scene when ``None``), reindex the scene's beats so ``index``
    mirrors array position, and return a **new** doc (``doc`` is never mutated).

    Lock enforcement (rule 2):
      - A locked scene (or a scene under a locked episode) is structurally
        frozen — inserting a beat into it raises ``LockViolation``.
      - Inserting *around* individually locked beats (``locked`` / ``scriptLocked``)
        in an unlocked scene is allowed (test plan line 19: "insertion before/
        after succeeds"); their ``index`` shifts but their content is preserved,
        which ``_assert_locked_content_unchanged`` verifies.

    Raises ``ValueError`` for an unknown scene or a bad ``after_beat_id`` (the
    route validates these first and maps them to 404/400)."""
    result = copy.deepcopy(doc)
    for episode, scene in _iter_scenes(result):
        if scene["id"] != scene_id:
            continue
        if episode.get("locked") or scene.get("locked"):
            raise LockViolation(f"cannot insert a beat into locked scene {scene_id!r}")
        beats = scene.get("beats", [])
        if after_beat_id is None:
            pos = 0
        else:
            idx = next((i for i, b in enumerate(beats) if b["id"] == after_beat_id), None)
            if idx is None:
                raise ValueError(f"{after_beat_id!r} is not a beat of scene {scene_id!r}")
            pos = idx + 1
        new_beats = beats[:pos] + [new_beat] + beats[pos:]
        for i, beat in enumerate(new_beats):
            beat["index"] = i
        scene["beats"] = new_beats
        _assert_locked_content_unchanged(doc, result)
        return result
    raise ValueError(f"scene {scene_id!r} not found")
