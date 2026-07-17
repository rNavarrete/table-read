"""The import transaction (data contract §4 `POST /projects/{pid}/import`,
and §9.3's atomic create-and-import — `fountain/create_import.py`).

Two-stage parse (prompt spec §7) → ledger extraction over imported scenes
(all facts `pending_review`, §4 step 2) → initial consistency scan (§4 step
3) → **one** write committing doc + ledger + flags (§4 step 4). Everything
that can fail — chiefly LLM calls and later analysis — runs
inside `analyze_import`, entirely *before* either caller's single DB write
(`run_import`'s `mutate()` below, or `create_import.py`'s
`create_project_with_state`), so a failure persists nothing.

`analyze_import` is a generator so a caller that wants named progress (the
create-and-import SSE stream, data contract §9.3: `parsing_scenes` /
`segmenting_beats` / `inferring_acts` / `inferring_entities` /
`inferring_promises` / `inferring_overview` / `extracting_facts` / `checking_consistency`) can
drive it one stage at a time; `run_import` below, which has no such caller,
drains it in one call via `run_to_completion`.

The LLM never controls text coverage (§7): `scriptText` is sliced verbatim
from the server-derived partition returned by `parse.normalize_and_slice`,
never transcribed by the model.

Logging is IDs + counts only — never script/plan/fact content (hard rule 5).
"""

from __future__ import annotations

import copy
import logging
from collections.abc import Callable, Generator
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import cast

from drama_manager import locks, render
from drama_manager.ledger_policy import IdMinter
from drama_manager.overview import merge_story_overview
from drama_manager.promises import merge_narrative_promises
from fountain import acts
from fountain.characters import (
    cues_from_scenes,
    merge_characters_into_bible,
    merge_inferred_entities,
    normalize_known_by,
)
from fountain.entity_inference import (
    ENTITY_INFER_USER_CHAR_BUDGET,
    chunk_entity_scene_summaries,
    combine_story_entities,
)
from fountain.object_states import detect_object_conflicts, infer_object_states
from fountain.parse import (
    CoverageError,
    ImportedBeat,
    SegmentationIssue,
    locate_source_text,
    normalize_and_slice,
    split_into_scenes,
)
from fountain.timeline import merge_timeline_anchors
from llm.errors import SchemaInvalidLlmError
from llm.protocol import LlmClient
from schemas import LedgerExtraction
from storage import snapshots
from storage.models import LedgerFactRow, ProjectRow

_logger = logging.getLogger("fountain.pipeline")

# Stage names in emission order (data contract §9.3 / packages/contract
# `ProjectImportStageName`). `analyze_import` yields `ImportStageStarted`
# for exactly these, in order, once each; "saving" is not among them — it
# belongs to the caller's own single DB write, which happens *after* analysis
# completes.
STAGE_PARSING_SCENES = "parsing_scenes"
STAGE_SEGMENTING_BEATS = "segmenting_beats"
STAGE_INFERRING_ACTS = "inferring_acts"
STAGE_INFERRING_ENTITIES = "inferring_entities"
STAGE_INFERRING_PROMISES = "inferring_promises"
STAGE_INFERRING_OVERVIEW = "inferring_overview"
STAGE_EXTRACTING_FACTS = "extracting_facts"
STAGE_CHECKING_CONSISTENCY = "checking_consistency"
IMPORT_LLM_CONCURRENCY = 4


@dataclass(frozen=True)
class ImportStageStarted:
    name: str


@dataclass(frozen=True)
class ImportStageProgress:
    stage: str
    done: int
    total: int


ImportPipelineEvent = ImportStageStarted | ImportStageProgress


@dataclass
class ImportAnalysis:
    """Everything `analyze_import` produces: a new project doc with the
    imported episode installed, the extracted (all `pending_review`) ledger
    facts, and the raw consistency flags — `sourceChange` left unstamped
    (`""`), exactly like `run_import`'s old inline `raw_flags`, because the
    snapshot id it belongs to isn't minted until the caller's write."""

    new_doc: dict
    new_facts: list[dict]
    raw_flags: list[dict]


def run_to_completion[T](gen: Generator[ImportPipelineEvent, None, T]) -> T:
    """Drive an `analyze_import`-shaped generator to completion, discarding
    the progress events it yields, and return its final value. For callers (like
    `run_import` below) that don't need per-stage progress."""
    try:
        while True:
            next(gen)
    except StopIteration as stop:
        return stop.value


def analyze_import(
    project_doc: dict,
    existing_ledger: list[dict],
    content: str,
    llm: LlmClient,
) -> Generator[ImportPipelineEvent, None, ImportAnalysis]:
    """Run every LLM/parsing stage of an import with **no DB access and no
    mutation**, yielding internal pipeline progress events and returning the
    assembled `ImportAnalysis` once complete. Shared analysis
    core for `run_import` (import into an existing project) and
    `fountain/create_import.py` (atomic create-and-import, T5) — the single
    place either caller's DB write can safely follow, because nothing here
    can fail *after* it.

    Raises `parse.CoverageError` (→ `VALIDATION`) on a coverage failure, and
    `locks.LockViolation` (→ `LOCKED_OBJECT`) when `project_doc` holds locked
    content or vouched facts `existing_ledger` can't be replaced (rule 2);
    both checked before any LLM call. Lets LLM errors propagate for the
    caller to map. A fresh (just-scaffolded, no seasons) `project_doc` with
    an empty `existing_ledger` is always writable, so create-and-import's
    guard call here is zero-cost."""
    if not content:
        # An empty import has no scenes to segment; reject before touching the LLM.
        raise CoverageError("import content is empty")

    # Rule 2 (T3.2): import-as-replace wipes the episode's scenes and the
    # whole ledger, so refuse a target holding locked content or vouched
    # (non pending_review) facts — before stage 1, so a refusal costs zero
    # LLM calls and zero mutations (test plan, Fountain round-trip section).
    locks.assert_import_target_writable(project_doc, existing_ledger)

    # ── Stage 1 + 2: deterministic split, then LLM segmentation + server-side
    # typed-start normalization + verbatim slicing, per scene. ──────────────
    yield ImportStageStarted(STAGE_PARSING_SCENES)
    spans = split_into_scenes(content)

    yield ImportStageStarted(STAGE_SEGMENTING_BEATS)
    per_scene_beats = yield from _run_ordered_parallel(
        spans,
        lambda index, span: _segment_one(index, span, project_doc, llm),
        stage=STAGE_SEGMENTING_BEATS,
    )

    # ── Infer the total act partition after all scenes have their semantic
    # summaries, but before scene assembly and every later LLM stage. ─────────
    yield ImportStageStarted(STAGE_INFERRING_ACTS)
    summaries = acts.scene_summaries(spans, per_scene_beats)
    system, user = render.build_act_inference_prompt(project_doc, summaries, render.new_nonce())
    inferred = llm.infer_act_breaks(
        system=system,
        user_message=user,
        prompt_version=render.PROMPT_VERSION,
    )
    selected_inference = inferred
    retried_acts = False
    try:
        scene_acts = acts.expand_act_starts(
            inferred,
            scene_count=len(spans),
            format_dict=project_doc["format"],
        )
    except acts.ActInferenceError as first_error:
        retried_acts = True
        retry_system, retry_user = render.build_act_inference_retry_prompt(
            project_doc,
            summaries,
            first_error.diagnostics,
            render.new_nonce(),
        )
        repaired = llm.infer_act_breaks(
            system=retry_system,
            user_message=retry_user,
            prompt_version=render.PROMPT_VERSION,
        )
        selected_inference = repaired
        try:
            scene_acts = acts.expand_act_starts(
                repaired,
                scene_count=len(spans),
                format_dict=project_doc["format"],
            )
        except acts.ActInferenceError as second_error:
            raise SchemaInvalidLlmError("infer_act_breaks") from second_error
    _logger.info(
        "import_infer_acts scenes=%d boundaries=%d retried=%s prompt_version=%s",
        len(spans),
        len(selected_inference.starts),
        retried_acts,
        render.PROMPT_VERSION,
    )

    # ── Assemble the episode doc with deterministic ids, carrying each beat's
    # unassigned ranges so they can be flagged. ──────────────────────────────
    scene_docs: list[dict] = []
    review_raw: list[tuple[str, SegmentationIssue]] = []
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
            review_raw.extend((beat_id, issue) for issue in beat.review_issues)
        scene_docs.append(
            {
                "id": f"scene-{si}",
                "index": si - 1,
                "act": scene_acts[si - 1],
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

    # ── Cast mint (T7.14): Fountain character cues → seriesBible.characters
    # before extract so knownBy resolves to real ids on every import. ────────
    bible = new_doc.setdefault("seriesBible", {})
    speaker_names = cues_from_scenes(scene_docs)
    characters = merge_characters_into_bible(bible, speaker_names)

    # ── Entity inference (§5a, T7.15): classifier call(s) over compact
    # scene summaries + the cue-derived speaker floor, merged into the bible
    # (characters incl. non-speaking ones + aliases, relationships, world
    # elements as worldQA) before extraction so extract/scan see the fuller
    # cast. Large imports are chunked under ENTITY_INFER_USER_CHAR_BUDGET so
    # a single giant prompt cannot 400 with prompt-too-long; small scripts
    # stay one chunk (same as the historical single call). Schema-invalid
    # output after the client's own retry-once (CLAUDE.md rule 9) propagates
    # as SchemaInvalidLlmError for any chunk — same atomic-failure contract
    # as segmentation/act inference. ──────────────────────────────────────
    yield ImportStageStarted(STAGE_INFERRING_ENTITIES)
    scene_summaries = _entity_scene_summaries(scene_docs)
    summary_chunks = chunk_entity_scene_summaries(
        scene_summaries, speaker_names, budget=ENTITY_INFER_USER_CHAR_BUDGET
    )
    # WARNING (not INFO): uvicorn's default app log level often hides INFO,
    # and these lines are the only signal that chunking ran on a large import.
    _logger.warning(
        "import_infer_entities_start scenes=%d chunks=%d speakers=%d "
        "budget=%d prompt_version=%s",
        len(scene_docs),
        len(summary_chunks),
        len(speaker_names),
        ENTITY_INFER_USER_CHAR_BUDGET,
        render.PROMPT_VERSION,
    )
    entity_parts = []
    for chunk_index, chunk in enumerate(summary_chunks):
        system, user = render.build_entity_prompt(
            new_doc, chunk, speaker_names, render.new_nonce()
        )
        _logger.warning(
            "import_infer_entities_chunk chunk=%d/%d scenes=%d "
            "user_chars=%d system_chars=%d",
            chunk_index + 1,
            len(summary_chunks),
            len(chunk),
            len(user),
            len(system),
        )
        entity_parts.append(
            llm.infer_story_entities(
                system=system,
                user_message=user,
                prompt_version=render.PROMPT_VERSION,
            )
        )
    entities = combine_story_entities(entity_parts)
    characters, relationship_states = merge_inferred_entities(bible, entities)
    _episode_ref(new_doc, episode_id)["relationshipStates"] = relationship_states
    _logger.info(
        "import_infer_entities characters=%d relationships=%d world_elements=%d "
        "chunks=%d prompt_version=%s",
        len(entities.characters),
        len(entities.relationships),
        len(entities.world_elements),
        len(summary_chunks),
        render.PROMPT_VERSION,
    )

    # ── Narrative promises (P2, T7.20): one classifier call over the same
    # scene summaries, now with the fuller cast resolved, so thread owners
    # and scene motivations can name any character entities just minted.
    # Merges threads onto the episode, motivations onto matching scenes, and
    # new (non-duplicate) world rules onto the bible — never overwriting or
    # duplicating a locked rule's text (drama_manager.promises). Same
    # schema-invalid-after-retry atomic-failure contract as every other
    # import LLM stage.
    #
    # Follow-up: `infer_narrative_promises` is still one-shot over all
    # scenes and can hit the same prompt-too-long class of failure on very
    # large imports. Do not naively reuse entity chunking — threads are
    # cross-scene by design (setup in chunk A / payoff in chunk B). A later
    # pass should choose overlapping windows or a second reduce step before
    # splitting. ─────────────────────────────────────────────────────────
    yield ImportStageStarted(STAGE_INFERRING_PROMISES)
    known_cast = [c["name"] for c in characters if c.get("name")]
    existing_world_rule_texts = [
        r["text"] for r in bible.get("worldRules") or [] if r.get("text")
    ]
    system, user = render.build_promises_prompt(
        new_doc,
        _entity_scene_summaries(scene_docs),
        known_cast,
        existing_world_rule_texts,
        render.new_nonce(),
    )
    narrative_promises = llm.infer_narrative_promises(
        system=system, user_message=user, prompt_version=render.PROMPT_VERSION
    )
    merge_narrative_promises(new_doc, episode_id, narrative_promises)
    _logger.info(
        "import_infer_promises threads=%d scene_motivations=%d world_rules=%d prompt_version=%s",
        len(narrative_promises.threads),
        len(narrative_promises.scene_motivations),
        len(narrative_promises.world_rules),
        render.PROMPT_VERSION,
    )


    # ── Story overview (T7.28): one classifier call after promises so the
    # synopsis can reflect thread/motivation tone without depending on the
    # fact wall. Merges Episode.storyOverview; backfills empty premises from
    # the logline; preserves locked overview (drama_manager.overview). ─────
    yield ImportStageStarted(STAGE_INFERRING_OVERVIEW)
    scene_spine, known_beats = _overview_prompt_inputs(scene_docs)
    system, user = render.build_overview_prompt(
        new_doc,
        scene_spine,
        known_beats,
        render.new_nonce(),
        known_cast=known_cast,
    )
    story_overview = llm.infer_story_overview(
        system=system, user_message=user, prompt_version=render.PROMPT_VERSION
    )
    merge_story_overview(new_doc, episode_id, story_overview)
    _logger.info(
        "import_infer_overview outline=%d beat_sheet=%d prompt_version=%s",
        len(story_overview.outline),
        len(story_overview.beat_sheet),
        render.PROMPT_VERSION,
    )

    # ── Ledger extraction (§4 step 2): every import-derived fact is
    # pending_review, regardless of confidence. Fresh ledger → no existing
    # facts to contradict. ───────────────────────────────────────────────────
    yield ImportStageStarted(STAGE_EXTRACTING_FACTS)
    extractions = yield from _run_ordered_parallel(
        scene_docs,
        lambda index, scene: _extract_one(index, scene, new_doc, episode_id, characters, llm),
        stage=STAGE_EXTRACTING_FACTS,
    )
    new_facts: list[dict] = []
    fact_minter = IdMinter([], "fact-")
    for extraction in extractions:
        for ef in extraction.new_facts:
            fact = _to_ledger_fact(ef, fact_minter.mint(), beat_index)
            normalized, characters = normalize_known_by(fact["knownBy"], characters)
            fact["knownBy"] = normalized
            resolved_events = []
            for event in fact["knowledgeEvents"]:
                event_character_ids, characters = normalize_known_by(
                    event["characterNames"], characters
                )
                resolved_events.append(
                    {
                        "sceneId": event["sceneId"],
                        "characterIds": event_character_ids,
                        "kind": event["kind"],
                        "quote": event["quote"],
                    }
                )
            fact["knowledgeEvents"] = resolved_events
            new_facts.append(fact)
    bible["characters"] = characters

    # ── Object custody / location continuity (T7.26, "simpler MVP"): a
    # deterministic pass over the just-extracted fact text, no new LLM
    # call. Stored on the episode; conflicts become open flags below. ──────
    object_states = infer_object_states(new_facts)
    _episode_ref(new_doc, episode_id)["objectStates"] = object_states

    # ── Consistency scan (§4 step 3): one sweep across the imported episode. ──
    yield ImportStageStarted(STAGE_CHECKING_CONSISTENCY)
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

    flag_minter = IdMinter([], "flag-")
    raw_flags: list[dict] = []
    for f in scan.flags:
        if f.object_id not in known_ids:  # §8c: drop flags for unknown ids
            continue
        dump = f.model_dump(by_alias=True, mode="json")
        raw_flags.append(
            {
                "id": flag_minter.mint(),
                "objectType": dump["objectType"],
                "objectId": dump["objectId"],
                "factId": dump["factId"],
                "explanation": dump["explanation"],
                "severity": dump["severity"],
                "status": "open",
                "sourceChange": "",  # stamped with the snapshot id by the caller's write
            }
        )
    for beat_id, issue in review_raw:
        raw_flags.append(
            {
                "id": flag_minter.mint(),
                "objectType": "beat",
                "objectId": beat_id,
                "factId": None,
                "explanation": _segmentation_issue_explanation(issue),
                "severity": "tension",
                "status": "open",
                "sourceChange": "",
            }
        )
    for conflict in detect_object_conflicts(object_states, scene_docs):
        raw_flags.append(
            {
                "id": flag_minter.mint(),
                "status": "open",
                "sourceChange": "",
                **conflict,
            }
        )

    return ImportAnalysis(new_doc=new_doc, new_facts=new_facts, raw_flags=raw_flags)


def _run_ordered_parallel[T, R](
    items: list[T],
    worker: Callable[[int, T], R],
    *,
    stage: str,
) -> Generator[ImportPipelineEvent, None, list[R]]:
    """Run per-scene LLM work concurrently while returning results by source index.

    On failure, pending futures are cancelled and the executor is not allowed to
    wait for unrelated in-flight calls. Already-running HTTP calls cannot be
    killed, but this generator raises immediately and emits no later progress.
    """
    if not items:
        return []

    results: list[R | None] = [None] * len(items)
    pool = ThreadPoolExecutor(max_workers=IMPORT_LLM_CONCURRENCY)
    try:
        futures = {pool.submit(worker, index, item): index for index, item in enumerate(items)}
        done = 0
        for future in as_completed(futures):
            index = futures[future]
            results[index] = future.result()
            done += 1
            yield ImportStageProgress(stage, done, len(items))
    except BaseException:
        pool.shutdown(wait=False, cancel_futures=True)
        raise
    else:
        pool.shutdown(wait=True)
    return [cast(R, result) for result in results]


def _segment_one(index: int, span, project_doc: dict, llm: LlmClient) -> list[ImportedBeat]:
    system, user = render.build_segment_prompt(project_doc, span.lines, render.new_nonce())
    segmented = llm.segment_scene(
        system=system, user_message=user, prompt_version=render.PROMPT_VERSION
    )
    first = normalize_and_slice(span, segmented)
    selected = first
    retried = False
    if first.should_retry:
        retried = True
        retry_system, retry_user = render.build_segment_retry_prompt(
            project_doc, span.lines, first.diagnostics, render.new_nonce()
        )
        retry_segmented = llm.segment_scene(
            system=retry_system,
            user_message=retry_user,
            prompt_version=render.PROMPT_VERSION,
        )
        second = normalize_and_slice(span, retry_segmented)
        if second.score.ranking_key() < first.score.ranking_key():
            selected = second
    _logger.info(
        "import_segment scene_index=%d scene_lines=%d retried=%s discarded_metadata=%d "
        "affected_lines=%d repair_events=%d prompt_version=%s",
        index,
        len(span.lines),
        retried,
        selected.score.discarded_beat_metadata,
        selected.score.affected_lines,
        selected.score.event_count,
        render.PROMPT_VERSION,
    )
    return selected.beats


def _extract_one(
    index: int,
    scene: dict,
    new_doc: dict,
    episode_id: str,
    characters: list[dict],
    llm: LlmClient,
) -> LedgerExtraction:
    del index
    system, user = render.build_extract_prompt(
        new_doc, episode_id, scene, [], characters, render.new_nonce()
    )
    return llm.extract_ledger_facts(
        system=system, user_message=user, prompt_version=render.PROMPT_VERSION
    )


_ENTITY_PROMPT_EARLY_LINES = 40



_OVERVIEW_SCRIPT_EXCERPT_LINES = 12


def _overview_prompt_inputs(scene_docs: list[dict]) -> tuple[list[dict], list[dict]]:
    """Richest compact spine + beat inventory for `infer_story_overview`.

    Scene-level `whatHappens` is empty at import assembly; roll up beat
    plan fields and a short script excerpt so the overview model sees
    story action, not only locations. Full scriptText stays out of the
    prompt (token + slugline-paste risk); excerpts are inert-wrapped by
    the renderer.
    """
    scene_spine: list[dict] = []
    known_beats: list[dict] = []
    for scene in scene_docs:
        beats = scene.get("beats") or []
        what_happens = " ".join(
            b["whatHappens"] for b in beats if b.get("whatHappens")
        )
        learns = " ".join(
            b["audienceLearns"] for b in beats if b.get("audienceLearns")
        )
        feels = " ".join(
            b["audienceFeels"] for b in beats if b.get("audienceFeels")
        )
        full_text = "\n".join(b.get("scriptText", "") for b in beats)
        excerpt = "\n".join(
            full_text.split("\n")[:_OVERVIEW_SCRIPT_EXCERPT_LINES]
        )
        scene_spine.append(
            {
                "sceneId": scene["id"],
                "act": scene.get("act", 0),
                "location": scene.get("location", ""),
                "whatHappens": what_happens,
                "audienceLearns": learns,
                "audienceFeels": feels,
                "scriptExcerpt": excerpt,
            }
        )
        for beat in beats:
            if not beat.get("id"):
                continue
            known_beats.append(
                {
                    "beatId": beat["id"],
                    "sceneId": scene["id"],
                    "whatHappens": beat.get("whatHappens") or "",
                    "audienceLearns": beat.get("audienceLearns") or "",
                    "audienceFeels": beat.get("audienceFeels") or "",
                }
            )
    return scene_spine, known_beats


def _entity_scene_summaries(scene_docs: list[dict]) -> list[dict]:
    """Per-scene `{id, location, whatHappens, scriptText}` summaries for
    `render.build_entity_prompt` (§5a): `whatHappens` rolls up each beat's
    semantic summary (already produced by segmentation, not transcribed
    text); `scriptText` is the scene's first `_ENTITY_PROMPT_EARLY_LINES`
    verbatim lines — a compact but on-page-grounded read for entity
    inference, source-data-wrapped by the renderer, never used to derive
    facts (extraction still reads full beat text)."""
    summaries = []
    for scene in scene_docs:
        beats = scene.get("beats") or []
        full_text = "\n".join(b.get("scriptText", "") for b in beats)
        what_happens = " ".join(b["whatHappens"] for b in beats if b.get("whatHappens"))
        summaries.append(
            {
                "id": scene["id"],
                "location": scene.get("location", ""),
                "whatHappens": what_happens,
                "scriptText": "\n".join(full_text.split("\n")[:_ENTITY_PROMPT_EARLY_LINES]),
            }
        )
    return summaries


def _segmentation_issue_explanation(issue: SegmentationIssue) -> str:
    """Writer-facing repair provenance. Stable codes make every deterministic
    normalization inspectable without logging or repeating source text."""
    line_range = (
        f"source lines {issue.start_line}-{issue.end_line}"
        if issue.start_line is not None and issue.end_line is not None
        else "the scene segmentation"
    )
    if issue.code == "model_unassigned":
        return (
            f"[model_unassigned] The model marked {line_range} as unassigned; "
            "the server preserved them in this beat. Review the boundary."
        )
    if issue.code == "duplicate_start":
        return (
            f"[duplicate_start] The model returned conflicting segments at scene line "
            f"{issue.model_start}; the server preserved {line_range} as unassigned and "
            f"discarded {issue.discarded_beat_metadata} conflicting beat metadata "
            "record(s). Review the boundary."
        )
    if issue.code == "missing_initial_start":
        return (
            f"[missing_initial_start] No segment began at scene line 1; the server "
            f"preserved {line_range} as unassigned. Review the boundary."
        )
    if issue.code in {"empty_output", "no_valid_segments"}:
        return (
            f"[{issue.code}] The model returned no usable segment starts; the server "
            f"preserved {line_range} as unassigned. Review this scene."
        )
    if issue.code == "out_of_bounds_start":
        return (
            f"[out_of_bounds_start] The model returned scene line {issue.model_start}, "
            "which is outside this scene; the server discarded that segment"
            + (
                f" and {issue.discarded_beat_metadata} beat metadata record(s)"
                if issue.discarded_beat_metadata
                else ""
            )
            + ". Review the selected beat boundaries."
        )
    if issue.code == "unordered_segments":
        return (
            "[unordered_segments] The model returned segment starts out of source order; "
            "the server reordered the attached segment objects. Review the boundaries."
        )
    return f"[{issue.code}] The server repaired {line_range}; review the boundary."


def run_import(
    session,
    project: ProjectRow,
    content: str,
    llm: LlmClient,
    *,
    instruction: str,
    expected_head_snapshot_id: str | None = None,
) -> dict:
    """Run the full import for `content` into `project`, returning
    `{project, newFacts, consistencyFlags}`. Raises `parse.CoverageError`
    (→ VALIDATION) on a coverage failure, `locks.LockViolation` (→ 409
    LOCKED_OBJECT) when the target holds locked content or vouched facts, and
    lets LLM errors propagate for the route to map; nothing is persisted until
    the final `mutate()` (see `analyze_import`'s docstring for why that's safe)."""
    existing_ledger = [
        row.to_wire_dict()
        for row in session.query(LedgerFactRow).filter_by(project_id=project.id).all()
    ]
    analysis = run_to_completion(analyze_import(project.doc, existing_ledger, content, llm))

    # ── the single write (§4 step 4): doc + ledger + flags in one snapshot. ──
    def mutator(state: snapshots.MutationState) -> snapshots.MutationState:
        flags = [{**f, "sourceChange": state.snapshot_id} for f in analysis.raw_flags]
        return snapshots.MutationState(
            doc=analysis.new_doc,
            ledger=analysis.new_facts,
            flags=flags,
            snapshot_id=state.snapshot_id,
        )

    snap = snapshots.mutate(
        session,
        project.id,
        instruction,
        mutator,
        expected_head_snapshot_id=expected_head_snapshot_id,
    )

    _logger.info(
        "import project=%s snapshot=%s prompt_version=%s facts=%d flags=%d",
        project.id,
        snap.id,
        render.PROMPT_VERSION,
        len(analysis.new_facts),
        len(snap.flags),
    )
    return {"project": snap.doc, "newFacts": snap.ledger, "consistencyFlags": snap.flags}


def _install_scenes(project_doc: dict, scene_docs: list[dict]) -> tuple[dict, str]:
    """Install the imported scenes as the project's single episode (MVP),
    preserving an existing season/episode's metadata or scaffolding one.
    Returns the new doc and the episode id the scenes now live under.

    Also (re)computes `timelineAnchors` (T7.24) from the new scene set via
    `fountain.timeline.merge_timeline_anchors` -- deterministic, no LLM.
    A re-import replaces them along with `scenes` since scene ids are
    reminted each import; there is nothing to preserve from the old set."""
    doc = copy.deepcopy(project_doc)
    timeline_anchors = merge_timeline_anchors(scene_docs)
    seasons = doc.get("seasons") or []
    if seasons and seasons[0].get("episodes"):
        episode = seasons[0]["episodes"][0]
        episode["scenes"] = scene_docs
        episode["timelineAnchors"] = timeline_anchors
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
        "timelineAnchors": timeline_anchors,
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


def _episode_ref(doc: dict, episode_id: str) -> dict:
    """The (mutable, in-place) episode dict with id `episode_id` in `doc`.
    MVP: exactly one season/episode, so this always finds the one
    `_install_scenes` just installed into."""
    for season in doc.get("seasons") or []:
        for episode in season.get("episodes") or []:
            if episode["id"] == episode_id:
                return episode
    raise KeyError(episode_id)


def _to_ledger_fact(extracted, fact_id: str, beat_index: dict) -> dict:
    """Convert one model `ExtractedFact` into a persisted `LedgerFact` wire dict:
    server-assigned id, `inferred`/`pending_review` (§4 step 2), and char
    offsets located verbatim within the referenced beat (§5).

    `knowledgeEvents` is carried through with names still unresolved
    (`characterNames`, not `characterIds`) — the caller (`analyze_import`)
    resolves them the same way it resolves `knownBy`, against the same
    running `characters` list, so a name introduced by one new fact's
    knownBy can still resolve a later fact's knowledgeEvents in the same
    import (T7.23)."""
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
        "id": fact_id,
        "fact": dump["fact"],
        "factType": dump["factType"],
        "sourceSpan": span,
        "sourceText": dump["sourceText"],
        "knownBy": dump["knownBy"],
        "knowledgeEvents": dump["knowledgeEvents"],
        "audienceKnows": dump["audienceKnows"],
        "provenance": "inferred",
        "confidence": dump["confidence"],
        "status": "pending_review",
        "supersedes": None,
        "supersededBy": None,
    }
