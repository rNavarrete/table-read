"""Read-side lock filter (CLAUDE.md hard rule 2).

**Locks are sacred.** Any code path that regenerates content MUST route through
this filter. T2.1 (candidate generation) is read-only w.r.t. the doc — it needs
to know *which* content is locked so locked beat text can be surfaced to the
model as an immutable constraint (prompt spec §1 `locked_beats`), and so the
context bundle never proposes overwriting it.

This grew a write-side surface for beat accept (T2.2); T3.2 lands the
direct-edit (PATCH) and import-as-replace guards; change-set apply (T4.2) will
extend it further:

  - `is_locked(doc, object_id)` — is this scene/beat locked, honoring the
    cascade below?
  - `locked_beats_in_scene(doc, scene_id)` — the locked beats (plan + script)
    to render as constraints.
  - `insert_beat(doc, scene_id, after_beat_id, new_beat)` — the *only* lock-safe
    beat-insertion path: rejects a locked scene/episode and guarantees no
    locked beat's content is ever modified (rule 2), returning a new doc.
  - `assert_no_locked_writes(old_doc, new_doc)` — the write-side guard for
    direct edits (PATCH). See "Write-side lock rule" below.
  - `assert_import_target_writable(doc, ledger)` — the write-side guard for
    import-as-replace (see its docstring).

**Write-side lock rule (T3.2 — data contract §4 "Patches into locked ranges →
409 LOCKED_OBJECT"; test plan line 19; UI spec §3/§4).** A write may not alter
content or structure protected by a lock that *holds in the pre-write doc*.
For every object locked in `old_doc` (by its own `locked`/`scriptLocked` or the
cascade below), in `new_doc`:
  - its content must be byte-identical — a locked beat's plan/scriptText, a
    locked scene's location/whatHappens/motivations/…, a locked episode's
    title/premise/storylines;
  - it may not be removed;
  - a locked *container* may not gain or lose children (no beat inserted into
    or removed from a locked scene; no scene added to/removed from a locked
    episode).
Two changes are **exempt** even on a locked object, because they are not the
"content" a lock protects:
  - the lock fields themselves (`locked`, `scriptLocked`) — unlocking is the
    writer's own pin, and the T3.1 lock toggle unlocks *via PATCH*; the guard
    must never block that (§4; UI spec §3 "locks are the writer's own pins");
  - `index` on a locked *beat* whose parent scene is **unlocked** — structural
    position among siblings, not content: reindexing around a locked beat after
    an insert in an unlocked scene is allowed (T2.2 ruling; test plan line 19
    "insertion before/after succeeds").
**Not exempt:** reordering (child ORDER) of beats **inside a locked scene**
(or scenes inside a locked episode) — the container's child order is frozen
(ruling 2). A locked scene's own `index` is frozen too (T3.8): a reorder may
not shift a locked scene, or any scene of a locked episode.
Inserting a beat *around* a locked beat in an *unlocked* scene is therefore
allowed (the scene isn't a locked container; the locked beat's content is
preserved, only its `index` moves). Undo is exempt: it does not route through
this guard (`storage/snapshots.restore_parent`), because undo restores prior
history and removing a pin that way is the writer's deliberate act (§3).

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
# guarantee. ``index`` is deliberately excluded from beat content: it is
# structural position. A locked beat in an *unlocked* scene may still shift
# index (sibling reindex). Child ORDER inside a *locked* scene is checked
# separately in ``assert_no_locked_writes`` (ruling 2).
_BEAT_CONTENT_FIELDS = (
    "id",
    "locked",
    "whatHappens",
    "audienceLearns",
    "audienceFeels",
    "scriptText",
    "scriptLocked",
)


def _iter_episodes(doc: dict):
    """Yield every episode in the project (MVP: one season, one episode)."""
    for season in doc.get("seasons", []):
        yield from season.get("episodes", [])


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
    """True if the scene/beat/episode/character `object_id` is locked, honoring
    the episode→scene→beat cascade. Characters carry their own `locked` pin
    (no cascade). Unknown ids — and ledger facts, which have no lock field —
    are treated as not locked (callers validate existence separately)."""
    episode, scene, beat = _find(doc, object_id)
    if beat is not None:
        return _beat_is_locked(episode, scene, beat)
    if scene is not None:
        return bool(episode.get("locked") or scene.get("locked"))
    if episode is not None:
        return bool(episode.get("locked"))
    for character in doc.get("seriesBible", {}).get("characters", []):
        if character.get("id") == object_id:
            return bool(character.get("locked"))
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


# Fields a locked object may still have changed by a write (see "Write-side
# lock rule"): its own lock pins (unlocking is the writer's gesture) and, for a
# beat, its `index` when the parent scene is unlocked (sibling reindex — T2.2).
# A locked scene's `index` is checked explicitly in `assert_no_locked_writes`
# (T3.8). Child ORDER inside a locked container is NOT exempt (ruling 2).
_EXEMPT_ON_LOCKED = frozenset(("locked", "scriptLocked", "index"))


def _content_projection(obj: dict, *, children_key: str | None) -> dict:
    """Everything about `obj` a lock protects: all fields except the lock pins,
    `index`, and the child collection (children are checked object-by-object)."""
    skip = _EXEMPT_ON_LOCKED | ({children_key} if children_key else frozenset())
    return {k: v for k, v in obj.items() if k not in skip}


def _child_order(children: list[dict]) -> list[str]:
    """Stable child id sequence (array order). Used to freeze order inside
    locked containers without blocking sibling reindex in unlocked ones."""
    return [c["id"] for c in children]


def assert_no_locked_writes(old_doc: dict, new_doc: dict) -> None:
    """Rule 2 write-side guard for direct edits (PATCH) — see the module
    header's "Write-side lock rule". Raises ``LockViolation`` (route → 409
    ``LOCKED_OBJECT``) if ``new_doc`` alters content or structure that a lock
    protects in ``old_doc``. Pure comparison of the two docs: it does not
    matter *how* the write was expressed (a deep JSON Pointer, an array splice,
    a whole-subtree replace) — only whether locked material survived byte-
    identical, so no write path can slip a locked edit past it.

    The lock/`scriptLocked` exemptions keep the writer's own unlock (T3.1
    toggle) working. ``index`` on locked beats remains exempt so sibling
    reindex in unlocked scenes works (test plan line 19); a locked scene's own
    ``index`` is frozen (T3.8), and child ORDER inside a locked scene/episode
    is blocked (ruling 2)."""
    new_beats = {b["id"]: b for _e, _s, b in _iter_beats(new_doc)}
    new_scenes = {s["id"]: s for _e, s in _iter_scenes(new_doc)}
    new_episodes = {e["id"]: e for e in _iter_episodes(new_doc)}

    for episode, scene, beat in _iter_beats(old_doc):
        if not _beat_is_locked(episode, scene, beat):
            continue
        after = new_beats.get(beat["id"])
        if after is None:
            raise LockViolation(f"locked beat {beat['id']!r} cannot be removed")
        if _content_projection(beat, children_key=None) != _content_projection(
            after, children_key=None
        ):
            raise LockViolation(f"cannot edit the content of locked beat {beat['id']!r}")

    for episode, scene in _iter_scenes(old_doc):
        if not (episode.get("locked") or scene.get("locked")):
            continue
        after = new_scenes.get(scene["id"])
        if after is None:
            raise LockViolation(f"locked scene {scene['id']!r} cannot be removed")
        if _content_projection(scene, children_key="beats") != _content_projection(
            after, children_key="beats"
        ):
            raise LockViolation(f"cannot edit the content of locked scene {scene['id']!r}")
        if after.get("index") != scene.get("index"):
            raise LockViolation(f"cannot move locked scene {scene['id']!r}")
        old_beats = scene.get("beats", [])
        new_beat_list = after.get("beats", [])
        if {b["id"] for b in old_beats} != {b["id"] for b in new_beat_list}:
            raise LockViolation(f"cannot add or remove beats in locked scene {scene['id']!r}")
        if _child_order(old_beats) != _child_order(new_beat_list):
            raise LockViolation(
                f"cannot reorder beats in locked scene {scene['id']!r}"
            )

    for episode in _iter_episodes(old_doc):
        if not episode.get("locked"):
            continue
        after = new_episodes.get(episode["id"])
        if after is None:
            raise LockViolation(f"locked episode {episode['id']!r} cannot be removed")
        if _content_projection(episode, children_key="scenes") != _content_projection(
            after, children_key="scenes"
        ):
            raise LockViolation(f"cannot edit the content of locked episode {episode['id']!r}")
        old_scenes = episode.get("scenes", [])
        new_scene_list = after.get("scenes", [])
        if {s["id"] for s in old_scenes} != {s["id"] for s in new_scene_list}:
            raise LockViolation(
                f"cannot add or remove scenes in locked episode {episode['id']!r}"
            )
        if _child_order(old_scenes) != _child_order(new_scene_list):
            raise LockViolation(
                f"cannot reorder scenes in locked episode {episode['id']!r}"
            )


def assert_import_target_writable(doc: dict, ledger: list[dict]) -> None:
    """Rule 2 guard for import-as-replace (test plan, Fountain round-trip
    section). Import wholesale replaces the target episode's scenes *and* the
    entire ledger, so it must refuse a target holding anything a writer has
    committed to: any locked episode/scene/beat, or any ledger fact that is not
    `pending_review` (i.e. one someone has vouched for — active, confirmed,
    superseded, …). Either would be silently destroyed by the replace.

    Raises ``LockViolation`` (route → 409 ``LOCKED_OBJECT``). Callers run it
    before stage 1 of the import, so a refusal costs zero LLM calls and zero
    mutations."""
    for episode in _iter_episodes(doc):
        if episode.get("locked"):
            raise LockViolation(f"cannot import over locked episode {episode['id']!r}")
    for _episode, scene in _iter_scenes(doc):
        if scene.get("locked"):
            raise LockViolation(f"cannot import over locked scene {scene['id']!r}")
    for _episode, _scene, beat in _iter_beats(doc):
        if beat.get("locked") or beat.get("scriptLocked"):
            raise LockViolation(f"cannot import over locked beat {beat['id']!r}")
    for fact in ledger:
        if fact.get("status") != "pending_review":
            raise LockViolation(
                f"cannot import over vouched fact {fact.get('id')!r} "
                f"(status {fact.get('status')!r}); import replaces the ledger"
            )
