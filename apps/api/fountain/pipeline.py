"""The import transaction (data contract §4 `POST /projects/{pid}/import`).

Two-stage parse (prompt spec §7) → ledger extraction over imported scenes
(all facts `pending_review`, §4 step 2) → initial consistency scan (§4 step 3)
→ **one** snapshot committing doc + ledger + flags (§4 step 4). Everything
that can fail — the LLM calls and the server-side coverage validation — runs
*before* the single `mutate()` write, so a failure persists nothing; the one
DB write is `mutate()`, whose atomicity (storage/snapshots.py) makes a
mid-transaction fault leave zero rows changed.

The LLM never controls text coverage (§7): `scriptText` is sliced verbatim
from the source by `parse.validate_and_slice`, never transcribed by the model.

Logging is IDs + counts only — never script/plan/fact content (hard rule 5).
"""

from __future__ import annotations

import copy
import logging

from drama_manager import locks, render
from fountain.parse import (
    ImportedBeat,
    locate_source_text,
    split_into_scenes,
    validate_and_slice,
)
from llm.protocol import LlmClient
from storage import snapshots
from storage.models import LedgerFactRow, ProjectRow

_logger = logging.getLogger("fountain.pipeline")


def run_import(
    session, project: ProjectRow, content: str, llm: LlmClient, *, instruction: str
) -> dict:
    """Run the full import for `content` into `project`, returning
    `{project, newFacts, consistencyFlags}`. Raises `parse.CoverageError`
    (→ VALIDATION) on a coverage failure, `locks.LockViolation` (→ 409
    LOCKED_OBJECT) when the target holds locked content or vouched facts, and
    lets LLM errors propagate for the route to map; nothing is persisted until
    the final `mutate()`."""
    if not content:
        # An empty import has no scenes to segment; reject before touching the LLM.
        from fountain.parse import CoverageError

        raise CoverageError("import content is empty")

    project_doc = project.doc

    # Rule 2 (T3.2): import-as-replace wipes the episode's scenes and the whole
    # ledger, so refuse a target holding locked content or vouched (non
    # pending_review) facts — before stage 1, so a refusal costs zero LLM calls
    # and zero mutations (test plan, Fountain round-trip section).
    existing_ledger = [
        row.to_wire_dict()
        for row in session.query(LedgerFactRow).filter_by(project_id=project.id).all()
    ]
    locks.assert_import_target_writable(project_doc, existing_ledger)

    # ── Stage 1 + 2: deterministic split, then LLM segmentation + server-side
    # coverage validation + verbatim slicing, per scene. ────────────────────
    spans = split_into_scenes(content)
    per_scene_beats: list[list[ImportedBeat]] = []
    for span in spans:
        system, user = render.build_segment_prompt(project_doc, span.lines, render.new_nonce())
        segmented = llm.segment_scene(
            system=system, user_message=user, prompt_version=render.PROMPT_VERSION
        )
        per_scene_beats.append(validate_and_slice(span, segmented))

    # ── Assemble the episode doc with deterministic ids, carrying each beat's
    # unassigned ranges so they can be flagged. ──────────────────────────────
    scene_docs: list[dict] = []
    unassigned_raw: list[tuple[str, tuple[int, int]]] = []
    for si, (span, beats) in enumerate(zip(spans, per_scene_beats, strict=True), start=1):
        beat_docs = []
        for bi, beat in enumerate(beats, start=1):
            beat_id = f"beat-{si}-{bi}"
            beat_docs.append(
                {
                    "id": beat_id,
                    "index": bi - 1,
                    "locked": False,
                    "whatHappens": beat.what_happens,
                    "audienceLearns": beat.audience_learns,
                    "audienceFeels": beat.audience_feels,
                    "scriptText": beat.script_text,
                    "scriptLocked": False,
                }
            )
            unassigned_raw.extend((beat_id, rng) for rng in beat.unassigned)
        scene_docs.append(
            {
                "id": f"scene-{si}",
                "index": si - 1,
                "act": 0,  # plain scripts carry no act markers (MVP); default cold-open act
                "storyline": "A",
                "locked": False,
                "location": span.location,
                "time": "",
                "socialSituation": "",
                "whatHappens": "",
                "audienceLearns": "",
                "audienceFeels": "",
                "motivations": [],
                "beats": beat_docs,
            }
        )

    new_doc, episode_id = _install_scenes(project_doc, scene_docs)
    beat_index = {b["id"]: b for s in scene_docs for b in s["beats"]}
    known_ids = set(beat_index) | {s["id"] for s in scene_docs}
    characters = new_doc.get("seriesBible", {}).get("characters", [])

    # ── Ledger extraction (§4 step 2): every import-derived fact is
    # pending_review, regardless of confidence. Fresh ledger → no existing
    # facts to contradict. ───────────────────────────────────────────────────
    new_facts: list[dict] = []
    for scene in scene_docs:
        system, user = render.build_extract_prompt(
            new_doc, episode_id, scene, [], characters, render.new_nonce()
        )
        extraction = llm.extract_ledger_facts(
            system=system, user_message=user, prompt_version=render.PROMPT_VERSION
        )
        for ef in extraction.new_facts:
            new_facts.append(_to_ledger_fact(ef, len(new_facts) + 1, beat_index))

    # ── Consistency scan (§4 step 3): one sweep across the imported episode. ──
    scene_summaries = [
        {"id": s["id"], "location": s["location"], "whatHappens": s["whatHappens"]}
        for s in scene_docs
    ]
    system, user = render.build_scan_prompt(
        new_doc, "imported script", scene_summaries, [], characters, render.new_nonce()
    )
    scan = llm.scan_consistency(
        system=system, user_message=user, prompt_version=render.PROMPT_VERSION
    )

    raw_flags: list[dict] = []
    for f in scan.flags:
        if f.object_id not in known_ids:  # §8c: drop flags for unknown ids
            continue
        dump = f.model_dump(by_alias=True, mode="json")
        raw_flags.append(
            {
                "id": f"flag-{len(raw_flags) + 1:02d}",
                "objectType": dump["objectType"],
                "objectId": dump["objectId"],
                "factId": dump["factId"],
                "explanation": dump["explanation"],
                "severity": dump["severity"],
                "status": "open",
                "sourceChange": "",  # stamped with the snapshot id inside the mutator
            }
        )
    for beat_id, (line_a, line_b) in unassigned_raw:
        raw_flags.append(
            {
                "id": f"flag-{len(raw_flags) + 1:02d}",
                "objectType": "beat",
                "objectId": beat_id,
                "factId": None,
                "explanation": (
                    f"Imported source lines {line_a}-{line_b} could not be assigned to a "
                    "beat during segmentation and were merged into this beat; review."
                ),
                "severity": "tension",
                "status": "open",
                "sourceChange": "",
            }
        )

    # ── The single write (§4 step 4): doc + ledger + flags in one snapshot. ──
    def mutator(state: snapshots.MutationState) -> snapshots.MutationState:
        flags = [{**f, "sourceChange": state.snapshot_id} for f in raw_flags]
        return snapshots.MutationState(
            doc=new_doc, ledger=new_facts, flags=flags, snapshot_id=state.snapshot_id
        )

    snap = snapshots.mutate(session, project.id, instruction, mutator)

    _logger.info(
        "import project=%s snapshot=%s prompt_version=%s scenes=%d beats=%d "
        "facts=%d flags=%d unassigned=%d",
        project.id,
        snap.id,
        render.PROMPT_VERSION,
        len(scene_docs),
        len(beat_index),
        len(new_facts),
        len(snap.flags),
        len(unassigned_raw),
    )
    return {"project": snap.doc, "newFacts": snap.ledger, "consistencyFlags": snap.flags}


def _install_scenes(project_doc: dict, scene_docs: list[dict]) -> tuple[dict, str]:
    """Install the imported scenes as the project's single episode (MVP),
    preserving an existing season/episode's metadata or scaffolding one.
    Returns the new doc and the episode id the scenes now live under."""
    doc = copy.deepcopy(project_doc)
    seasons = doc.get("seasons") or []
    if seasons and seasons[0].get("episodes"):
        episode = seasons[0]["episodes"][0]
        episode["scenes"] = scene_docs
        return doc, episode["id"]

    episode = {
        "id": "ep-1",
        "index": 0,
        "locked": False,
        "title": doc.get("title", ""),
        "premise": "",
        "seasonFunction": "",
        "storylines": [],
        "scenes": scene_docs,
    }
    if seasons:
        seasons[0]["episodes"] = [episode]
    else:
        doc["seasons"] = [
            {
                "id": "season-1",
                "index": 0,
                "locked": False,
                "seasonArc": "",
                "characterArcs": [],
                "episodes": [episode],
            }
        ]
    return doc, episode["id"]


def _to_ledger_fact(extracted, ordinal: int, beat_index: dict) -> dict:
    """Convert one model `ExtractedFact` into a persisted `LedgerFact` wire dict:
    server-assigned id, `inferred`/`pending_review` (§4 step 2), and char
    offsets located verbatim within the referenced beat (§5)."""
    dump = extracted.model_dump(by_alias=True, mode="json")
    span = dict(dump["sourceSpan"])  # episodeId/sceneId/beatId/startLine/endLine
    beat = beat_index.get(span["beatId"])
    char_start, char_end = (None, None)
    if beat is not None:
        char_start, char_end = locate_source_text(
            beat["scriptText"], dump["sourceText"], span["startLine"], span["endLine"]
        )
    span["charStart"] = char_start
    span["charEnd"] = char_end
    return {
        "id": f"fact-{ordinal:02d}",
        "fact": dump["fact"],
        "factType": dump["factType"],
        "sourceSpan": span,
        "sourceText": dump["sourceText"],
        "knownBy": dump["knownBy"],
        "audienceKnows": dump["audienceKnows"],
        "provenance": "inferred",
        "confidence": dump["confidence"],
        "status": "pending_review",
        "supersedes": None,
        "supersededBy": None,
    }
