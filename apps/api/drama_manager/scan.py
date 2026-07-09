"""Consistency-scan helpers (§8c) shared by the write paths that scan after a
mutation: beat accept (T2.2), import (T1.3), and direct structural edits (T3.2).

Two responsibilities live here so all three paths behave identically:

  - `build_consistency_flags` — the flag-dropping policy: a scan flag is kept
    only if it references a *known*, *untouched*, *unlocked* object (test plan
    line 27 — flags on changed / locked-out / unknown ids are dropped
    server-side). `sourceChange` is stamped with the snapshot id inside the
    mutator, so it is left `""` here.
  - `run_direct_edit_scan` — the structural-PATCH transaction (data contract
    §4): scan the post-edit doc, then commit `doc` + new flags in one snapshot,
    returning `{project, consistencyFlags}`.

`touches_structural_field` decides whether a PATCH is structural at all
(§4 names scene `whatHappens`, `premise`, and storyline summaries as the
structural plan fields).

**Atomicity (data contract §4 + T2.2 precedent).** §4 says a structural PATCH
returns `{project, consistencyFlags}` — one coherent post-edit state whose
flags' `sourceChange` is that edit's snapshot. So the scan runs *before* the
single `mutate()` and its flags commit in the same snapshot as the doc: an LLM
failure persists nothing (the route maps it to SCHEMA_INVALID_LLM /
LLM_UNAVAILABLE), exactly like accept (drama_manager/accept.py) and import.
Rule 9 forbids fabricating an empty-scan fallback.

No writer text is logged here (hard rule 5); this module logs nothing.
"""

from __future__ import annotations

from drama_manager import ledger_filter, ledger_policy, locks, render
from drama_manager.ledger_filter import RelevanceContext
from storage import snapshots
from storage.models import ConsistencyFlagRow, LedgerFactRow, ProjectRow


def build_consistency_flags(
    scan,
    doc: dict,
    changed_object_ids: set[str],
    existing_flags: list[dict],
) -> list[dict]:
    """Turn a `ConsistencyScan` into new `ConsistencyFlag` wire dicts (§8c),
    dropping any flag that references a changed, locked-out, or unknown object
    (test plan line 27). `sourceChange` is stamped by the caller's mutator."""
    known_ids = {s["id"] for _e, s in locks._iter_scenes(doc)}
    known_ids |= {b["id"] for _e, _s, b in locks._iter_beats(doc)}
    minter = ledger_policy.IdMinter([f["id"] for f in existing_flags], "flag-")
    out: list[dict] = []
    for flag in scan.flags:
        dump = flag.model_dump(by_alias=True, mode="json")
        object_id = dump["objectId"]
        if object_id not in known_ids:
            continue  # unknown id
        if object_id in changed_object_ids:
            continue  # the changed object is not "untouched"
        if locks.is_locked(doc, object_id):
            continue  # locked-out object
        out.append(
            {
                "id": minter.mint(),
                "objectType": dump["objectType"],
                "objectId": object_id,
                "factId": dump["factId"],
                "explanation": dump["explanation"],
                "severity": dump["severity"],
                "status": "open",
                "sourceChange": "",  # stamped with the snapshot id in the mutator
            }
        )
    return out


def _structural_values(doc: dict) -> dict:
    """The §4 structural plan fields, keyed for a cheap old-vs-new comparison:
    scene `whatHappens`, project + episode `premise`, and storyline summaries."""
    values: dict[str, object] = {"premise": doc.get("premise")}
    for episode in locks._iter_episodes(doc):
        values[f"ep:{episode['id']}:premise"] = episode.get("premise")
        for storyline in episode.get("storylines", []):
            values[f"ep:{episode['id']}:sl:{storyline.get('id')}"] = storyline.get("summary")
    for _episode, scene in locks._iter_scenes(doc):
        values[f"sc:{scene['id']}:whatHappens"] = scene.get("whatHappens")
    return values


def touches_structural_field(old_doc: dict, new_doc: dict) -> bool:
    """True if the edit changed any §4 structural plan field (so PATCH must run
    `scan_consistency` and return flags). Diff-based, so it catches the change
    however the patch expressed it, and treats an added/removed scene or
    storyline as a structural change too."""
    return _structural_values(old_doc) != _structural_values(new_doc)


def _changed_scene_ids(old_doc: dict, new_doc: dict) -> set[str]:
    """Scene ids whose object differs old→new — the objects the edit *touched*,
    whose own scan flags are dropped (they are not 'untouched')."""
    old_scenes = {s["id"]: s for _e, s in locks._iter_scenes(old_doc)}
    changed: set[str] = set()
    for _episode, scene in locks._iter_scenes(new_doc):
        if old_scenes.get(scene["id"]) != scene:
            changed.add(scene["id"])
    return changed


def run_direct_edit_scan(
    session,
    project: ProjectRow,
    new_doc: dict,
    llm,
    *,
    instruction: str,
    expected_head_snapshot_id: str | None = None,
) -> dict:
    """Run `scan_consistency` for a structural PATCH and commit `new_doc` + the
    resulting flags in one snapshot, returning `{project, consistencyFlags}`
    (data contract §4). Lets LLM errors propagate for the route to map; nothing
    is persisted until the final `mutate()` (see the module header).

    `expected_head_snapshot_id` is the client's `headSnapshotId` at edit time —
    passed through to `mutate` for optimistic concurrency (409
    `CONFLICT_STALE_HEAD` when the head moved)."""
    old_doc = project.doc
    changed_ids = _changed_scene_ids(old_doc, new_doc)

    existing_flags = [
        row.to_wire_dict()
        for row in session.query(ConsistencyFlagRow).filter_by(project_id=project.id).all()
    ]
    ledger = [
        row.to_wire_dict()
        for row in session.query(LedgerFactRow).filter_by(project_id=project.id).all()
    ]
    characters = new_doc.get("seriesBible", {}).get("characters", [])
    all_character_ids = frozenset(c["id"] for c in characters)

    # Facts eligible for the scan context, relevant to a touched scene.
    context_scene = next(iter(changed_ids), "")
    scan_facts = [
        {
            "id": f.get("id"),
            "fact": f.get("fact", ""),
            "factType": f.get("factType"),
            "knownBy": f.get("knownBy", []),
            "audienceKnows": f.get("audienceKnows", True),
        }
        for f in ledger_filter.eligible_facts(
            ledger,
            RelevanceContext(scene_id=context_scene, characters_in_scene=all_character_ids),
        )
    ]
    untouched = [
        {"id": s["id"], "location": s.get("location", ""), "whatHappens": s.get("whatHappens", "")}
        for _e, s in locks._iter_scenes(new_doc)
    ]
    change_summary = {"kind": "direct structural edit", "sceneIds": sorted(changed_ids)}
    system, user = render.build_scan_prompt(
        new_doc, change_summary, untouched, scan_facts, characters, render.new_nonce()
    )
    scan = llm.scan_consistency(
        system=system, user_message=user, prompt_version=render.PROMPT_VERSION
    )
    new_flags = build_consistency_flags(scan, new_doc, changed_ids, existing_flags)

    def mutator(state: snapshots.MutationState) -> snapshots.MutationState:
        flags = state.flags + [{**f, "sourceChange": state.snapshot_id} for f in new_flags]
        return snapshots.MutationState(
            doc=new_doc, ledger=state.ledger, flags=flags, snapshot_id=state.snapshot_id
        )

    snap = snapshots.mutate(
        session,
        project.id,
        instruction,
        mutator,
        expected_head_snapshot_id=expected_head_snapshot_id,
    )
    response_flags = [f for f in snap.flags if f["sourceChange"] == snap.id]
    return {"project": snap.doc, "consistencyFlags": response_flags}
