"""The beat-accept transaction (data contract §4 `POST .../scenes/{sid}/beats`).

This is where generated content *enters the project*. Pipeline:

  1. Build the writer-approved beat from the accepted candidate; insert it
     lock-safely (drama_manager/locks.py — rule 2) into a **new** doc.
  2. `extract_ledger_facts` over the accepted delta (the new beat only), then
     apply the server ledger policy (confidence, verbatim sourceText, supersede
     proposals; drama_manager/ledger_policy.py — §5).
  3. `scan_consistency` over untouched material (§8c), against the post-accept
     eligible ledger; drop flags for the changed / locked-out / unknown ids.
  4. **One** snapshot committing doc + ledger + flags together
     (storage/snapshots.py `mutate` — rule 4, obligation 1).

**Failure policy (obligation 7).** Both LLM calls run *before* the single
`mutate()`, so an extract/scan failure persists nothing — the accept is atomic,
exactly like the import transaction (data contract §4: "One snapshot committing
doc + ledger + flags together; partial failure rolls back all of it"). This is
the only contract-consistent reading: obligation 1 mandates one snapshot for
beat + facts + flags (so extraction must precede the write), and rule 9 forbids
fabricating an empty-extraction fallback. The route maps the propagated LLM
errors to `SCHEMA_INVALID_LLM` / `LLM_UNAVAILABLE`.

Logging is IDs + counts only — never script / plan / fact content (hard rule 5).
"""

from __future__ import annotations

import logging

from drama_manager import ledger_filter, ledger_policy, locks, render, scan
from drama_manager.ledger_filter import RelevanceContext
from schemas import BeatCandidate
from storage import snapshots
from storage.models import ConsistencyFlagRow, LedgerFactRow, ProjectRow

_logger = logging.getLogger("drama_manager.accept")


class SceneNotFound(LookupError):
    """The scene id is not present in the project doc (route → 404)."""


class BeatNotFound(LookupError):
    """`afterBeatId` is not a beat of the target scene (route → 400)."""


def _locate_scene(doc: dict, scene_id: str) -> tuple[dict, dict]:
    for season in doc.get("seasons", []):
        for episode in season.get("episodes", []):
            for scene in episode.get("scenes", []):
                if scene["id"] == scene_id:
                    return episode, scene
    raise SceneNotFound(scene_id)


def validate_target(doc: dict, scene_id: str, after_beat_id: str | None) -> None:
    """Validate the accept target up front so bad ids surface as HTTP errors
    before any LLM call. Raises `SceneNotFound` / `BeatNotFound`."""
    _episode, scene = _locate_scene(doc, scene_id)
    if after_beat_id is not None and not any(
        b["id"] == after_beat_id for b in scene.get("beats", [])
    ):
        raise BeatNotFound(after_beat_id)


def _mint_beat_id(doc: dict, scene_id: str) -> str:
    """Server-assigned kebab beat id following the fixture convention
    `beat-{sceneNumber}-{n}` (clients never mint ids; CLAUDE.md conventions).
    `n` is one past the highest existing suffix in the scene, bumped past any
    collision with a beat id anywhere in the doc."""
    segment = scene_id.rsplit("-", 1)[-1]
    prefix = f"beat-{segment}-"
    all_ids = {beat["id"] for _e, _s, beat in locks._iter_beats(doc)}
    _episode, scene = _locate_scene(doc, scene_id)
    scene_numbers = [
        int(beat["id"][len(prefix):])
        for beat in scene.get("beats", [])
        if beat["id"].startswith(prefix) and beat["id"][len(prefix):].isdigit()
    ]
    n = max(scene_numbers, default=0)
    while True:
        n += 1
        candidate = f"{prefix}{n}"
        if candidate not in all_ids:
            return candidate


def _beat_from_candidate(candidate: BeatCandidate, beat_id: str) -> dict:
    """Build the persisted `Beat` wire dict from an accepted candidate. The
    candidate's `continuityConflicts` were the writer's decision-time context
    (design doc: the writer decides) and are not persisted on the beat — genuine
    continuity issues are re-derived by extraction + scan below."""
    return {
        "id": beat_id,
        "index": 0,  # set by locks.insert_beat during reindex
        "locked": False,
        "whatHappens": candidate.beat_plan.what_happens,
        "audienceLearns": candidate.beat_plan.audience_learns,
        "audienceFeels": candidate.beat_plan.audience_feels,
        "scriptText": candidate.script_text,
        "scriptLocked": False,
    }


def _fact_summary(fact: dict) -> dict:
    return {
        "id": fact.get("id"),
        "fact": fact.get("fact", ""),
        "factType": fact.get("factType"),
        "knownBy": fact.get("knownBy", []),
        "audienceKnows": fact.get("audienceKnows", True),
    }


def _build_flags(
    scan_result, new_doc: dict, changed_beat_id: str, existing_flags: list[dict]
) -> list[dict]:
    """Turn a `ConsistencyScan` into new `ConsistencyFlag` wire dicts (§8c),
    dropping flags on the changed beat / locked-out / unknown ids (test plan
    line 27). Delegates to the shared policy (drama_manager/scan.py) so accept,
    import, and direct-edit scans drop flags identically."""
    return scan.build_consistency_flags(
        scan_result, new_doc, {changed_beat_id}, existing_flags
    )


def run_accept(
    session,
    project: ProjectRow,
    candidate: BeatCandidate,
    after_beat_id: str | None,
    llm,
    *,
    scene_id: str,
    instruction: str,
) -> dict:
    """Run the full accept for `candidate` into `scene_id`, returning
    `{project, newFacts, contradictions, consistencyFlags}` (data contract §4).

    Raises `locks.LockViolation` (→ 409 LOCKED_OBJECT) if the target scene is
    locked, and lets LLM errors propagate for the route to map. Nothing is
    persisted until the final `mutate()` (atomic; see the module header)."""
    doc = project.doc
    episode, _scene = _locate_scene(doc, scene_id)  # SceneNotFound handled by the route
    episode_id = episode["id"]

    new_beat = _beat_from_candidate(candidate, _mint_beat_id(doc, scene_id))
    new_doc = locks.insert_beat(doc, scene_id, after_beat_id, new_beat)

    existing_ledger = [
        row.to_wire_dict()
        for row in session.query(LedgerFactRow).filter_by(project_id=project.id).all()
    ]
    existing_flags = [
        row.to_wire_dict()
        for row in session.query(ConsistencyFlagRow).filter_by(project_id=project.id).all()
    ]
    characters = new_doc.get("seriesBible", {}).get("characters", [])

    # ── §5 extraction over the accepted delta (the new beat only) ─────────────
    extract_scene = {"id": scene_id, "beats": [new_beat]}
    system, user = render.build_extract_prompt(
        new_doc, episode_id, extract_scene, existing_ledger, characters, render.new_nonce()
    )
    extraction = llm.extract_ledger_facts(
        system=system, user_message=user, prompt_version=render.PROMPT_VERSION
    )
    new_facts, proposals, contradictions = ledger_policy.apply_extraction_policy(
        extraction,
        existing_ledger=existing_ledger,
        accepted_beat=new_beat,
        episode_id=episode_id,
        scene_id=scene_id,
    )
    appended = new_facts + proposals
    new_ledger = existing_ledger + appended

    # ── §8c consistency scan over untouched material ──────────────────────────
    all_character_ids = frozenset(c["id"] for c in characters)
    scan_facts = [
        _fact_summary(f)
        for f in ledger_filter.eligible_facts(
            new_ledger, RelevanceContext(scene_id=scene_id, characters_in_scene=all_character_ids)
        )
    ]
    untouched = [
        {"id": s["id"], "location": s.get("location", ""), "whatHappens": s.get("whatHappens", "")}
        for _e, s in locks._iter_scenes(new_doc)
    ]
    change_summary = {
        "beatId": new_beat["id"],
        "sceneId": scene_id,
        "whatHappens": new_beat["whatHappens"],
        "audienceLearns": new_beat["audienceLearns"],
    }
    system, user = render.build_scan_prompt(
        new_doc, change_summary, untouched, scan_facts, characters, render.new_nonce()
    )
    scan_result = llm.scan_consistency(
        system=system, user_message=user, prompt_version=render.PROMPT_VERSION
    )
    new_flags = _build_flags(scan_result, new_doc, new_beat["id"], existing_flags)

    # ── the single write (obligation 1): doc + ledger + flags in one snapshot ─
    def mutator(state: snapshots.MutationState) -> snapshots.MutationState:
        flags = state.flags + [{**f, "sourceChange": state.snapshot_id} for f in new_flags]
        return snapshots.MutationState(
            doc=new_doc,
            ledger=state.ledger + appended,
            flags=flags,
            snapshot_id=state.snapshot_id,
        )

    snap = snapshots.mutate(session, project.id, instruction, mutator)

    response_flags = [f for f in snap.flags if f["sourceChange"] == snap.id]
    _logger.info(
        "accept project=%s snapshot=%s prompt_version=%s beat=%s new_facts=%d "
        "proposals=%d contradictions=%d flags=%d",
        project.id,
        snap.id,
        render.PROMPT_VERSION,
        new_beat["id"],
        len(new_facts),
        len(proposals),
        len(contradictions),
        len(response_flags),
    )
    return {
        "project": snap.doc,
        "newFacts": new_facts,
        "contradictions": contradictions,
        "consistencyFlags": response_flags,
    }
