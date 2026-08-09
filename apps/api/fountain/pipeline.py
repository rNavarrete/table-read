"""The import transaction (data contract §4 `POST /projects/{pid}/import`,
and §9.3's atomic create-and-import — `fountain/create_import.py`).

Two-stage parse (prompt spec §7) → ledger extraction over imported scenes
(all facts `pending_review`, §4 step 2) → initial consistency scan (§4 step
3) → **one** write committing doc + ledger + flags (§4 step 4). Everything
that can fail — chiefly LLM calls and later analysis — runs
inside `analyze_import`, entirely *before* either caller's single project write
(`run_import`'s `mutate()` below, or `create_import.py`'s
`create_project_with_state`). The analysis core has no DB dependency; the
create path may inject a checkpoint callback that durably saves completed
pre-project units without creating partial project state.

`analyze_import` is a generator so a caller that wants named progress (the
create-and-import SSE stream, data contract §9.3: `parsing_scenes` /
`segmenting_beats` / `inferring_acts` / `inferring_entities` /
`inferring_promises` / `inferring_overview` / `extracting_facts` /
`checking_consistency`) can
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
from dataclasses import asdict, dataclass
from typing import cast

from pydantic import BaseModel

from drama_manager import locks, render
from drama_manager.ledger_policy import IdMinter
from drama_manager.narrative_map import NarrativeMapValidationError, merge_narrative_map
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
    ENTITY_INFER_MAX_SCENES_PER_CHUNK,
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
    strip_screenplay_front_matter,
)
from fountain.timeline import merge_timeline_anchors, slugline_time
from llm.errors import SchemaInvalidLlmError, classify_llm_unavailable_reason
from llm.protocol import LlmClient
from schemas import (
    ConsistencyScan,
    InferredStoryOverview,
    LedgerExtraction,
    NarrativePromises,
    StoryEntities,
)
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
ImportCheckpointWriter = Callable[[str, dict | list, int | None], None]


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
    *,
    checkpoint: dict | None = None,
    checkpoint_writer: ImportCheckpointWriter | None = None,
    nonce: str | None = None,
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
    guard call here is zero-cost.

    `nonce` is the `<source_data_{nonce}>` boundary tag for **every** call this
    run makes (§8b). One run, one nonce: the injection boundary holds either
    way — the source text can no more guess a run-scoped nonce than a per-call
    one — while a per-call nonce would rewrite the prompt prefix on every
    request and make prompt caching over a shared source payload impossible.
    Defaults to a fresh mint so existing callers are unaffected; pass the
    run's own value to keep it stable across a resumed/checkpointed import."""
    checkpoint = checkpoint or {}
    run_nonce = nonce or render.new_nonce()
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
    yield ImportStageProgress(STAGE_PARSING_SCENES, 0, 1)
    stripped = strip_screenplay_front_matter(content)
    if stripped.removed_line_count:
        _logger.info(
            "import_front_matter_stripped removed_lines=%d removed_chars=%d",
            stripped.removed_line_count,
            stripped.removed_char_count,
        )
    content = stripped.content
    if not content.strip():
        raise CoverageError("import contains only screenplay front matter")
    spans = split_into_scenes(content)
    _write_checkpoint(
        checkpoint_writer,
        STAGE_PARSING_SCENES,
        {"sceneCount": len(spans)},
    )
    yield ImportStageProgress(STAGE_PARSING_SCENES, 1, 1)

    yield ImportStageStarted(STAGE_SEGMENTING_BEATS)
    cached_beats = _load_segment_checkpoints(checkpoint, len(spans))
    # One whole-script payload for every scene's segmentation call. Boundaries
    # are decided locally, but what a beat MEANS — that it plants something a
    # later scene pays off — is only visible with the rest of the episode in
    # view, and this makes that context ~0.1x input per warm call.
    split_source = render.build_split_source_block(
        [(span.location, span.lines) for span in spans], run_nonce
    )
    per_scene_beats = yield from _run_ordered_parallel(
        spans,
        lambda index, span: _segment_one(
            index, span, project_doc, llm, run_nonce, split_source
        ),
        stage=STAGE_SEGMENTING_BEATS,
        existing_results=cached_beats,
        # Every call carries `split_source`; without warming, the first four
        # workers each write it.
        warm_cache_first=True,
        on_result=lambda index, beats: _write_checkpoint(
            checkpoint_writer,
            STAGE_SEGMENTING_BEATS,
            _dump_imported_beats(beats),
            index,
        ),
    )

    # ── Infer the total act partition after all scenes have their semantic
    # summaries, but before scene assembly and every later LLM stage. ─────────
    yield ImportStageStarted(STAGE_INFERRING_ACTS)
    summaries = acts.scene_summaries(spans, per_scene_beats)
    cached_scene_acts = _load_scene_acts_checkpoint(checkpoint, len(spans))
    if cached_scene_acts is not None:
        scene_acts = cached_scene_acts
        retried_acts = False
        boundary_count = 0
        yield ImportStageProgress(STAGE_INFERRING_ACTS, 1, 1)
    else:
        yield ImportStageProgress(STAGE_INFERRING_ACTS, 0, 1)
        system, user = render.build_act_inference_prompt(
            project_doc, summaries, run_nonce
        )
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
                run_nonce,
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
        boundary_count = len(selected_inference.starts)
        _write_checkpoint(
            checkpoint_writer,
            STAGE_INFERRING_ACTS,
            {"sceneActs": scene_acts},
        )
        yield ImportStageProgress(STAGE_INFERRING_ACTS, 1, 1)
    _logger.info(
        "import_infer_acts scenes=%d boundaries=%d retried=%s prompt_version=%s",
        len(spans),
        boundary_count,
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
                # The slugline already says when the scene happens; leaving
                # `time` empty made the Plan inspector look unpopulated on
                # every imported scene.
                "time": slugline_time(span.location),
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

    # ── Entity inference (§5a, T7.15): import_worker (Sonnet) calls over compact
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
        scene_summaries,
        # Each request receives only speakers appearing in its own scenes.
        # Passing the global cast here previously asked every chunk to emit
        # evidence for every cue-derived speaker, even when absent.
        [],
        budget=ENTITY_INFER_USER_CHAR_BUDGET,
        max_scenes=ENTITY_INFER_MAX_SCENES_PER_CHUNK,
    )
    entity_parts = _load_model_unit_checkpoints(
        checkpoint,
        STAGE_INFERRING_ENTITIES,
        len(summary_chunks),
        StoryEntities,
    )
    completed_entity_chunks = sum(part is not None for part in entity_parts)
    yield ImportStageProgress(
        STAGE_INFERRING_ENTITIES,
        completed_entity_chunks,
        len(summary_chunks),
    )
    # WARNING (not INFO): uvicorn's default app log level often hides INFO,
    # and these lines are the only signal that chunking ran on a large import.
    _logger.warning(
        "import_infer_entities_start scenes=%d chunks=%d speakers=%d budget=%d "
        "max_scenes_per_chunk=%d prompt_version=%s",
        len(scene_docs),
        len(summary_chunks),
        len(speaker_names),
        ENTITY_INFER_USER_CHAR_BUDGET,
        ENTITY_INFER_MAX_SCENES_PER_CHUNK,
        render.PROMPT_VERSION,
    )
    scene_docs_by_id = {scene["id"]: scene for scene in scene_docs}
    for chunk_index, chunk in enumerate(summary_chunks):
        if entity_parts[chunk_index] is not None:
            continue
        chunk_scene_docs = [
            scene_docs_by_id[summary["id"]]
            for summary in chunk
            if summary["id"] in scene_docs_by_id
        ]
        chunk_speakers = cues_from_scenes(chunk_scene_docs)
        system, user = render.build_entity_prompt(
            new_doc, chunk, chunk_speakers, run_nonce
        )
        _logger.warning(
            "import_infer_entities_chunk chunk=%d/%d scenes=%d speakers=%d "
            "user_chars=%d system_chars=%d",
            chunk_index + 1,
            len(summary_chunks),
            len(chunk),
            len(chunk_speakers),
            len(user),
            len(system),
        )
        entity_part = llm.infer_story_entities(
            system=system,
            user_message=user,
            prompt_version=render.PROMPT_VERSION,
            # Same prefix the segmentation loop already warmed. Chunking here
            # bounds the OUTPUT (three chunks returned 14.6k output tokens on
            # a 27-scene script against an 8192 ceiling), but each chunk can
            # now see the whole cast when deciding names and aliases.
            cache_prefix=split_source,
        )
        entity_parts[chunk_index] = entity_part
        _write_checkpoint(
            checkpoint_writer,
            STAGE_INFERRING_ENTITIES,
            entity_part.model_dump(by_alias=True, mode="json"),
            chunk_index,
        )
        completed_entity_chunks += 1
        yield ImportStageProgress(
            STAGE_INFERRING_ENTITIES,
            completed_entity_chunks,
            len(summary_chunks),
        )
    entities = combine_story_entities([cast(StoryEntities, part) for part in entity_parts])
    # Pass the imported script so an inferred character the script never names
    # is dropped rather than minted (a real import produced one called
    # "placeholder"). Uses the post-front-matter `content`, so a name that
    # only ever appeared on the title page or SETS list doesn't count as
    # grounding either.
    characters, relationship_states = merge_inferred_entities(
        bible, entities, content
    )
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

    # ── Narrative promises (P2, T7.20): one import_analyst (Opus) call over a
    # beat-complete semantic spine with bounded server-selected evidence excerpts.
    # The fuller cast is resolved first, so thread owners and scene motivations can
    # name any character entities just minted without replaying a full screenplay.
    # Merges threads onto the episode, motivations onto matching scenes, and
    # new (non-duplicate) world rules onto the bible — never overwriting or
    # duplicating a locked rule's text (drama_manager.promises). Same
    # schema-invalid-after-retry atomic-failure contract as every other
    # import LLM stage.
    # ─────────────────────────────────────────────────────────────────────
    yield ImportStageStarted(STAGE_INFERRING_PROMISES)
    known_cast = [c["name"] for c in characters if c.get("name")]
    existing_world_rule_texts = [r["text"] for r in bible.get("worldRules") or [] if r.get("text")]
    narrative_promises = _load_model_checkpoint(
        checkpoint, STAGE_INFERRING_PROMISES, NarrativePromises
    )
    if narrative_promises is None:
        yield ImportStageProgress(STAGE_INFERRING_PROMISES, 0, 2)
        promises_spine = _promises_prompt_spine(scene_docs)
        system, user = render.build_promises_prompt(
            new_doc,
            promises_spine,
            known_cast,
            existing_world_rule_texts,
            run_nonce,
        )
        _logger.info(
            "import_infer_promises_start scenes=%d beats=%d prompt_chars=%d "
            "prompt_version=%s",
            len(promises_spine),
            sum(len(scene["beats"]) for scene in promises_spine),
            len(user),
            render.PROMPT_VERSION,
        )
        yield ImportStageProgress(STAGE_INFERRING_PROMISES, 1, 2)
        narrative_promises = llm.infer_narrative_promises(
            system=system, user_message=user, prompt_version=render.PROMPT_VERSION
        )
        _write_checkpoint(
            checkpoint_writer,
            STAGE_INFERRING_PROMISES,
            narrative_promises.model_dump(by_alias=True, mode="json"),
        )
    merge_narrative_promises(new_doc, episode_id, narrative_promises)
    yield ImportStageProgress(STAGE_INFERRING_PROMISES, 2, 2)
    _logger.info(
        "import_infer_promises threads=%d scene_motivations=%d world_rules=%d prompt_version=%s",
        len(narrative_promises.threads),
        len(narrative_promises.scene_motivations),
        len(narrative_promises.world_rules),
        render.PROMPT_VERSION,
    )

    # ── Story overview (T7.28): one import_analyst (Opus) call after promises so the
    # synopsis can reflect thread/motivation tone without depending on the
    # fact wall. Merges Episode.storyOverview; backfills empty premises from
    # the logline; preserves locked overview (drama_manager.overview). ─────
    yield ImportStageStarted(STAGE_INFERRING_OVERVIEW)
    scene_spine, known_beats = _overview_prompt_inputs(scene_docs)
    story_overview = _load_model_checkpoint(
        checkpoint, STAGE_INFERRING_OVERVIEW, InferredStoryOverview
    )
    if story_overview is None:
        yield ImportStageProgress(STAGE_INFERRING_OVERVIEW, 0, 1)
        system, user = render.build_overview_prompt(
            new_doc,
            scene_spine,
            known_beats,
            run_nonce,
            known_cast=known_cast,
        )
        story_overview = llm.infer_story_overview(
            system=system, user_message=user, prompt_version=render.PROMPT_VERSION
        )
        _write_checkpoint(
            checkpoint_writer,
            STAGE_INFERRING_OVERVIEW,
            story_overview.model_dump(by_alias=True, mode="json"),
        )
    merge_story_overview(new_doc, episode_id, story_overview)
    yield ImportStageProgress(STAGE_INFERRING_OVERVIEW, 1, 1)
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
    cached_extractions = _load_model_unit_checkpoints(
        checkpoint,
        STAGE_EXTRACTING_FACTS,
        len(scene_docs),
        LedgerExtraction,
    )
    # One whole-episode payload, built once and reused verbatim by every scene
    # call, so the prompt prefix stays byte-identical and caches (§ measured at
    # ~0.1x input per warm call). Extraction is the op that most needs it: who
    # already knows a fact, and whether a later scene contradicts it, are not
    # answerable from the target scene alone.
    episode_source = render.build_episode_source_block(scene_docs, run_nonce)
    extractions = yield from _run_ordered_parallel(
        scene_docs,
        lambda index, scene: _extract_one(
            index, scene, new_doc, episode_id, characters, llm, run_nonce,
            episode_source,
        ),
        stage=STAGE_EXTRACTING_FACTS,
        existing_results=cached_extractions,
        # Same race as segmentation — every call carries `episode_source`.
        warm_cache_first=True,
        on_result=lambda index, extraction: _write_checkpoint(
            checkpoint_writer,
            STAGE_EXTRACTING_FACTS,
            extraction.model_dump(by_alias=True, mode="json"),
            index,
        ),
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
    scene_summaries = _entity_scene_summaries(scene_docs)
    fact_summaries = [
        {
            "id": fact["id"],
            "fact": fact["fact"],
            "factType": fact["factType"],
            "sourceSpan": fact["sourceSpan"],
            "knownBy": fact["knownBy"],
            "audienceKnows": fact["audienceKnows"],
        }
        for fact in new_facts
    ]
    scan = _load_model_checkpoint(
        checkpoint, STAGE_CHECKING_CONSISTENCY, ConsistencyScan
    )
    if scan is None:
        yield ImportStageProgress(STAGE_CHECKING_CONSISTENCY, 0, 1)
        system, user = render.build_scan_prompt(
            new_doc,
            "imported script",
            scene_summaries,
            fact_summaries,
            characters,
            run_nonce,
        )
        scan = llm.scan_consistency(
            system=system, user_message=user, prompt_version=render.PROMPT_VERSION
        )
        _write_checkpoint(
            checkpoint_writer,
            STAGE_CHECKING_CONSISTENCY,
            scan.model_dump(by_alias=True, mode="json"),
        )
    yield ImportStageProgress(STAGE_CHECKING_CONSISTENCY, 1, 1)

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


def analyze_narrative_map(
    project_doc: dict, llm: LlmClient, *, nonce: str | None = None
) -> dict:
    """Return a copy of ``project_doc`` with a fresh, grounded Narrative Map.

    Narrative mapping is intentionally not part of the atomic script import:
    it is a large optional synthesis request, while scenes, facts, and the
    story overview are the restart-sensitive import result. Running it as a
    separate snapshot mutation means a timeout can never discard those
    completed import calls or make a retry re-send the source script.

    Like `analyze_import`, this is one run and takes one `<source_data>` nonce
    for every call it makes — including the semantic retry, which re-sends the
    same source and so must not rewrite the prompt prefix (see
    `render.new_nonce`).
    """
    run_nonce = nonce or render.new_nonce()
    new_doc = copy.deepcopy(project_doc)
    episode = next(
        (
            episode
            for season in new_doc.get("seasons") or []
            for episode in season.get("episodes") or []
        ),
        None,
    )
    if episode is None or not episode.get("scenes"):
        raise CoverageError("a narrative map requires an imported script")

    episode_id = episode["id"]
    scene_docs = episode["scenes"]
    characters = (new_doc.get("seriesBible") or {}).get("characters") or []
    # The map grounds claims through beat IDs; it does not need to re-read the
    # full screenplay after segmentation has already supplied beat semantics.
    # Keeping raw scriptText out avoids a large duplicate prompt and makes the
    # explicit map action reliably bounded for long episodes.
    narrative_spine = _narrative_map_scene_spine(scene_docs, include_script_text=False)
    cast = [
        {"id": character["id"], "name": character["name"], "aliases": character.get("aliases", [])}
        for character in characters
        if character.get("id") and character.get("name")
    ]
    system, user = render.build_narrative_map_prompt(
        new_doc,
        narrative_spine,
        cast,
        episode.get("threads") or [],
        run_nonce,
    )
    narrative_map = llm.infer_narrative_map(
        system=system, user_message=user, prompt_version=render.PROMPT_VERSION
    )
    retried = False
    try:
        merge_narrative_map(new_doc, episode_id, narrative_map)
    except NarrativeMapValidationError as first_error:
        retried = True
        retry_system, retry_user = render.build_narrative_map_retry_prompt(
            new_doc,
            narrative_spine,
            cast,
            episode.get("threads") or [],
            first_error.diagnostics,
            run_nonce,
        )
        repaired_map = llm.infer_narrative_map(
            system=retry_system,
            user_message=retry_user,
            prompt_version=render.PROMPT_VERSION,
        )
        try:
            merge_narrative_map(new_doc, episode_id, repaired_map)
            narrative_map = repaired_map
        except NarrativeMapValidationError as second_error:
            raise SchemaInvalidLlmError("infer_narrative_map") from second_error

    _logger.info(
        "narrative_map_generated scenes=%d themes=%d acts=%d arcs=%d scene_turns=%d retried=%s "
        "prompt_version=%s",
        len(scene_docs),
        len(narrative_map.themes),
        len(narrative_map.acts),
        len(narrative_map.character_arcs),
        len(narrative_map.scene_turns),
        retried,
        render.PROMPT_VERSION,
    )
    return new_doc


def _write_checkpoint(
    writer: ImportCheckpointWriter | None,
    stage: str,
    value: dict | list,
    unit_index: int | None = None,
) -> None:
    if writer is not None:
        writer(stage, value, unit_index)


def _dump_imported_beats(beats: list[ImportedBeat]) -> list[dict]:
    return [asdict(beat) for beat in beats]


def _load_imported_beats(value: object) -> list[ImportedBeat] | None:
    if not isinstance(value, list):
        return None
    beats: list[ImportedBeat] = []
    try:
        for raw in value:
            if not isinstance(raw, dict):
                return None
            issues = [
                SegmentationIssue(**issue)
                for issue in raw.get("review_issues", [])
                if isinstance(issue, dict)
            ]
            beats.append(
                ImportedBeat(
                    what_happens=str(raw["what_happens"]),
                    audience_learns=str(raw["audience_learns"]),
                    audience_feels=str(raw["audience_feels"]),
                    script_text=str(raw["script_text"]),
                    unassigned=[
                        (int(pair[0]), int(pair[1]))
                        for pair in raw.get("unassigned", [])
                    ],
                    review_issues=issues,
                )
            )
    except (KeyError, TypeError, ValueError):
        return None
    return beats


def _load_segment_checkpoints(
    checkpoint: dict, scene_count: int
) -> list[list[ImportedBeat] | None]:
    results: list[list[ImportedBeat] | None] = [None] * scene_count
    units = checkpoint.get(STAGE_SEGMENTING_BEATS)
    if not isinstance(units, dict):
        return results
    for raw_index, value in units.items():
        try:
            index = int(raw_index)
        except (TypeError, ValueError):
            continue
        if 0 <= index < scene_count:
            results[index] = _load_imported_beats(value)
    return results


def _load_scene_acts_checkpoint(
    checkpoint: dict, scene_count: int
) -> list[int] | None:
    value = checkpoint.get(STAGE_INFERRING_ACTS)
    if not isinstance(value, dict):
        return None
    scene_acts = value.get("sceneActs")
    if (
        not isinstance(scene_acts, list)
        or len(scene_acts) != scene_count
        or any(not isinstance(act, int) for act in scene_acts)
    ):
        return None
    return list(scene_acts)


def _load_model_checkpoint[T: BaseModel](
    checkpoint: dict,
    stage: str,
    model_type: type[T],
) -> T | None:
    value = checkpoint.get(stage)
    if not isinstance(value, dict):
        return None
    try:
        return model_type.model_validate(value)
    except ValueError:
        return None


def _load_model_unit_checkpoints[T: BaseModel](
    checkpoint: dict,
    stage: str,
    unit_count: int,
    model_type: type[T],
) -> list[T | None]:
    results: list[T | None] = [None] * unit_count
    units = checkpoint.get(stage)
    if not isinstance(units, dict):
        return results
    for raw_index, value in units.items():
        try:
            index = int(raw_index)
        except (TypeError, ValueError):
            continue
        if not 0 <= index < unit_count or not isinstance(value, dict):
            continue
        try:
            results[index] = model_type.model_validate(value)
        except ValueError:
            continue
    return results


def _run_ordered_parallel[T, R](
    items: list[T],
    worker: Callable[[int, T], R],
    *,
    stage: str,
    existing_results: list[R | None] | None = None,
    on_result: Callable[[int, R], None] | None = None,
    warm_cache_first: bool = False,
) -> Generator[ImportPipelineEvent, None, list[R]]:
    """Run per-scene LLM work concurrently while returning results by source index.

    On failure, pending futures are cancelled and the executor is not allowed to
    wait for unrelated in-flight calls. Already-running HTTP calls cannot be
    killed, but this generator raises immediately and emits no later progress.

    `warm_cache_first` runs the first outstanding item alone before fanning
    out. Set it when the worker sends a shared cached prefix: otherwise the
    first IMPORT_LLM_CONCURRENCY calls all start before any cache entry
    exists and each pays a full cache write. Measured on a real 60-page
    import: three redundant 30k-token writes per loop, about $0.18 each on
    the Sonnet import worker. The cost is one scene of serial latency; the
    saving is every redundant write in that loop.
    """
    if not items:
        return []

    if existing_results is not None and len(existing_results) != len(items):
        raise ValueError("existing result count must match item count")
    results: list[R | None] = (
        list(existing_results) if existing_results is not None else [None] * len(items)
    )
    done = sum(result is not None for result in results)
    yield ImportStageProgress(stage, done, len(items))
    missing = [
        (index, item)
        for index, item in enumerate(items)
        if results[index] is None
    ]
    if not missing:
        return [cast(R, result) for result in results]

    # Warm the shared prefix on one call before fanning out. Uses the first
    # OUTSTANDING item rather than index 0, so a checkpointed resume warms
    # with work it actually has to do instead of redoing a finished scene.
    if warm_cache_first and len(missing) > 1:
        warm_index, warm_item = missing[0]
        warm_result = worker(warm_index, warm_item)
        if on_result is not None:
            on_result(warm_index, warm_result)
        results[warm_index] = warm_result
        done += 1
        yield ImportStageProgress(stage, done, len(items))
        missing = missing[1:]

    pool = ThreadPoolExecutor(max_workers=IMPORT_LLM_CONCURRENCY)
    try:
        futures = {
            pool.submit(worker, index, item): index
            for index, item in missing
        }
        for future in as_completed(futures):
            index = futures[future]
            result = future.result()
            if on_result is not None:
                on_result(index, result)
            results[index] = result
            done += 1
            yield ImportStageProgress(stage, done, len(items))
    except BaseException:
        # A provider request can fail while other submitted calls have already
        # completed or are about to complete. Persist those results before
        # surfacing the failure so a retry never pays for them a second time.
        pool.shutdown(wait=True, cancel_futures=True)
        for future, index in futures.items():
            if results[index] is not None or future.cancelled() or not future.done():
                continue
            try:
                completed_result = future.result()
            except BaseException:
                continue
            if on_result is not None:
                on_result(index, completed_result)
            results[index] = completed_result
        raise
    else:
        pool.shutdown(wait=True)
    return [cast(R, result) for result in results]


def _segment_one(
    index: int,
    span,
    project_doc: dict,
    llm: LlmClient,
    run_nonce: str,
    split_source: str | None = None,
) -> list[ImportedBeat]:
    """Segment one scene, with the whole split script as cached context.

    `split_source` is built once per run and passed unchanged (see
    `render.build_split_source_block`); rebuilding it here would still be
    byte-identical today but invites a per-scene detail to creep in and
    silently kill the cache."""
    system, user = render.build_segment_prompt(project_doc, span.lines, run_nonce)
    segmented = llm.segment_scene(
        system=system,
        user_message=user,
        prompt_version=render.PROMPT_VERSION,
        cache_prefix=split_source,
    )
    first = normalize_and_slice(span, segmented)
    selected = first
    retried = False
    if first.should_retry:
        retried = True
        retry_system, retry_user = render.build_segment_retry_prompt(
            project_doc, span.lines, first.diagnostics, run_nonce
        )
        retry_segmented = llm.segment_scene(
            system=retry_system,
            user_message=retry_user,
            prompt_version=render.PROMPT_VERSION,
            # Same prefix as the first attempt: a retry re-sends the same
            # source and must not pay a second cache write.
            cache_prefix=split_source,
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
    run_nonce: str,
    episode_source: str | None = None,
) -> LedgerExtraction:
    """Extract facts for one scene, with the whole episode as cached context.

    `episode_source` is built once per run and passed unchanged to every call
    (see `render.build_episode_source_block`). It must not be rebuilt here: a
    per-call rebuild would still be byte-identical today, but it invites a
    future per-call detail to creep in and silently kill the cache."""
    system, user = render.build_extract_prompt(
        new_doc, episode_id, scene, [], characters, run_nonce
    )
    try:
        return llm.extract_ledger_facts(
            system=system,
            user_message=user,
            prompt_version=render.PROMPT_VERSION,
            cache_prefix=episode_source,
        )
    except Exception as exc:
        reason_class, _reason = classify_llm_unavailable_reason(exc)
        if reason_class != "other_invalid_request":
            raise
        _logger.warning(
            "import_extract_retry scene_index=%d beat_count=%d script_chars=%d "
            "reason_class=%s prompt_version=%s",
            index,
            len(scene.get("beats") or []),
            sum(len(beat.get("scriptText") or "") for beat in scene.get("beats") or []),
            reason_class,
            render.PROMPT_VERSION,
        )
        # Anthropic occasionally returns a request-level 400 for an otherwise
        # valid per-scene tool request. It has no generated content to charge
        # or checkpoint, so one clean reissue is safe; any second failure is
        # still surfaced and preserves every completed scene checkpoint.
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
        what_happens = " ".join(b["whatHappens"] for b in beats if b.get("whatHappens"))
        learns = " ".join(b["audienceLearns"] for b in beats if b.get("audienceLearns"))
        feels = " ".join(b["audienceFeels"] for b in beats if b.get("audienceFeels"))
        full_text = "\n".join(b.get("scriptText", "") for b in beats)
        excerpt = "\n".join(full_text.split("\n")[:_OVERVIEW_SCRIPT_EXCERPT_LINES])
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


def _promises_prompt_spine(scene_docs: list[dict]) -> list[dict]:
    """Return every semantic beat, with no raw screenplay payload.

    Narrative threads need the whole episode. This used to also carry six
    positionally-sampled lines per scene so the model had on-page material to
    quote — but six lines out of a 500-line scene are chosen by index, not
    relevance, so the model could not cite the line that states a secret
    unless it happened to land on a sample point, and the quotes that came
    back were fragments. Since 0.40.0 the model cites a beatId instead and the
    server derives the line from that beat's full text, which it already
    holds; the excerpt is dead weight.
    """
    return _narrative_map_scene_spine(scene_docs, include_script_text=False)


def _narrative_map_scene_spine(
    scene_docs: list[dict], *, include_script_text: bool = True
) -> list[dict]:
    """Return a beat-complete semantic spine, optionally with raw script text.

    Import narrative promises and the Narrative Map both rely on the complete
    beat plan to discover late setup/payoff moves. The Narrative Map cites
    beat IDs, while promises adds its own bounded scene evidence excerpts;
    neither path needs a duplicate full-screenplay payload by default.
    """
    scene_spine: list[dict] = []
    for scene in scene_docs:
        beats: list[dict] = []
        for beat in scene.get("beats") or []:
            beat_data = {
                "beatId": beat["id"],
                "whatHappens": beat.get("whatHappens", ""),
                "audienceLearns": beat.get("audienceLearns", ""),
                "audienceFeels": beat.get("audienceFeels", ""),
            }
            if include_script_text:
                beat_data["scriptText"] = beat.get("scriptText", "")
            beats.append(beat_data)
        scene_spine.append(
            {
                "sceneId": scene["id"],
                "act": scene.get("act", 0),
                "location": scene.get("location", ""),
                "beats": beats,
            }
        )
    return scene_spine


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
    if issue.code == "no_beats_returned":
        return (
            "[no_beats_returned] The model returned no beats for this scene; the server "
            f"preserved {line_range} as a single beat with no description. The scene's "
            "text is intact, but its beat breakdown is missing. Re-run the breakdown for "
            "this scene."
        )
    if issue.code == "empty_beat_fields":
        return (
            f"[empty_beat_fields] The beat covering {line_range} came back with no "
            "description; the server kept the boundary but has nothing to show for it. "
            "Re-run the breakdown for this scene."
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
        # Re-import invalidates any beat-grounded map. The writer can request
        # a fresh map after the new script snapshot has safely committed.
        episode["narrativeMap"] = None
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
        "narrativeMap": None,
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
