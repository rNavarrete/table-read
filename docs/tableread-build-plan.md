# Table Read MVP Build Plan

Ordered milestones, agent-sized tasks, acceptance criteria. Reference docs: design doc (`narrative-sidekick-design-doc.md`), data contract, prompt spec, UI spec, test plan, fixture (`tableread-fixture.json`). Single-user, single-episode, four modes (design doc §8).

**Definition of done (every task):** typed against the data contract; unit tests pass; no direct Anthropic calls in tests (mock client); lint clean; fixture-based e2e for UI tasks; task's acceptance criteria demonstrably met.

## Milestone 0 — Scaffold (parallel-safe)

**T0.1 Repo scaffold.** Monorepo: `apps/web` (React 18 + TS + Vite + Tailwind), `apps/api` (FastAPI + Python 3.12 + SQLAlchemy + SQLite), `packages/contract` (Zod schemas + generated TS types). Root `CLAUDE.md`, `Makefile` (`make dev|test|lint|check-contract`).
_Accept:_ `make dev` boots both apps; `make test` green on empty suites.

**T0.2 Contract implementation.** Zod schemas + Pydantic mirrors + `scripts/check_contract.py` per data contract §5.
_Accept:_ fixture JSON validates against both sides; intentional field rename fails `make check-contract`.

**T0.3 Fixture + seed.** Load `tableread-fixture.json` via `make seed`. The fixture is a **persisted-state envelope** (`project`, `ledger`, `snapshots` with root `snap-root`, plus empty `consistencyFlags`/`changeSets`/`suggestionHistory`) — seed writes each key to its store verbatim.
_Accept:_ GET `/projects/{pid}` returns the fixture project with `headSnapshotId: "snap-root"`; ledger endpoint returns its 8 facts; snapshots table has exactly the root row, whose `doc`/`ledger` match the live stores; undo immediately after seed → 409 (root has no parent).

**T0.4 Design tokens.** Tokens from UI spec §1 as CSS variables + Tailwind theme.
_Accept:_ Storybook (or a `/tokens` dev page) renders swatches for all tokens, light theme.

## Milestone 1 — Project core (API-first)

**T1.1 Project CRUD + snapshots.** `POST/GET/PATCH /projects`, snapshot-per-mutation, `POST /undo`, `DELETE` purge.
_Accept:_ PATCH → new snapshot + head bump in one transaction; undo restores prior doc byte-identical; delete leaves zero project-scoped rows across **all six DB tables plus embeddings** (`projects`, `snapshots`, `ledger_facts`, `change_sets`, `consistency_flags`, `suggestion_history`).

**T1.2 Mock LLM client + Anthropic client.** `LlmClient` protocol; `MockLlmClient` replays canned responses keyed by operation + fixture inputs; `AnthropicClient` with tool-forced JSON, one schema-retry, `PROMPT_VERSION` logging.
_Accept:_ all ops callable against mock; retry path unit-tested (first response invalid → second valid); tests never hit network.

**T1.3 Fountain export + import.** Export walks scenes/beats emitting `scriptText`; import = full transaction per data contract §4: two-stage parse (prompt spec §7) → ledger extraction over imported scenes (all facts `pending_review`) → initial consistency scan → one snapshot committing doc + ledger + flags.
_Accept:_ fixture exports to valid Fountain (round-trips through `fountain-js` parse); importing that export reproduces scene/beat count and returns `{project, newFacts, consistencyFlags}` with every imported fact `pending_review`; typed segment starts normalize to a total partition per T7.10; unassigned/repair ranges are preserved in scriptText and flagged; reconstructed text is byte-identical to source; a mid-transaction failure leaves zero rows changed.

## Milestone 2 — Write mode

**T2.1 Candidate generation endpoint.** SSE per data contract; sequential diversity calls; context bundle per prompt spec §1 (ledger filtering, locked beats, token budget).
_Accept:_ streams 3 `candidate_done` events with schema-valid `BeatCandidate`s against mock; a mock invalid candidate emits `candidate_failed`, not a partial card; context bundle snapshot-tested (locked beat text present, facts filtered by `isPromptEligibleFact` — prompt spec §8, all freeform fields wrapped in `<source_data kind="...">` tags, ≤6k tokens on fixture); cards actionable only after `candidate_done`.

**T2.2 Accept/Tune/Skip + ledger hook.** Accept inserts beat + snapshot + fires `extract_ledger_facts` and `scan_consistency`; tune endpoint; skip is client-side.
_Accept:_ accepting fixture candidate adds beat with correct `index`; new facts land `pending_review` when confidence <0.8, else `active`; contradiction creates supersede proposal without overwriting (fact-07 case from prompt spec); mock scan flags surface in the accept response.

**T2.3 Write mode UI.** Script canvas (teleplay CSS), right candidate cards with labels + Accept/Tune/Skip, bottom command bar, streaming text. States per UI spec §3: empty, streaming, error.
_Accept:_ e2e (Playwright + mock API): open fixture scene-3 → "Next Beat" → 3 labeled cards stream in → Accept → beat appears in script → ledger badge increments. AI controls invisible while textarea focused (spec §3).

**T2.4 Write script home.** Episode-continuous scrollable script + left scene outline + active-scene generation target (design: `docs/superpowers/specs/2026-07-14-write-script-home-design.md`). Client-only; Plan remains structural. No contract/prompt changes.
_Accept:_ Write shows a scrollport with all episode scenes stacked; outline lists every scene and click jumps + highlights active; Next Beat / command bar use active scene; `[`/`]` step scenes when not typing; `?scene=` / Ledger `highlightBeat` still land correctly; unit tests for outline, stacked canvas, WriteScreen scrollport.

**T2.5 Write autosave.** Typed script text saves through `PATCH /projects/{pid}` (~1 s debounce, plus blur / scene change / unmount) on one serial queue shared with Accept; generation, Tune and Undo flush first (UI spec §4 "Saving").
_Accept:_ Vitest — one save ~1 s after typing stops; flush saves at once; edits to a beat coalesce to the latest text; an Accept queued behind an in-flight save runs on the new head and both succeed; one Accept at a time; Next Beat / Tune wait for the flush ("Saving…"), build their request after it, and don't run if it fails; a stale head refetches and retries once unless the beat changed elsewhere; locked / removed / changed beats drop the edit with one notice and never block; a retryable failure keeps the text and Retry re-saves; beforeunload only while an edit or Accept is saving; Undo/restore run in the queue after pending saves; mode switch waits ≤ ~1.5 s; effectively locked beats and the optimistic Accept row are read-only; unmount flushes. E2E (`write-autosave.spec.ts`) — type, wait for the save, reload → text persists; type then Accept while the save is held in flight → both persist, one PATCH, no 409, no refetch.

## Milestone 3 — Plan mode (simplified board)

**T3.1 Board UI.** One episode: act columns (or rows) as frames, scene cards, expandable beat cards; select → right inspector (fields per UI spec §4); lock toggles; drag to reorder scenes (PATCH index swap).
_Accept:_ e2e: reorder scene-4 before scene-3 persists after reload; lock icon renders on beat-1-2 (locked in fixture); inspector shows motivations + affected ledger facts (facts whose sourceSpan is in the selected scene).

**T3.2 Direct edits.** Inspector field edits → `PATCH /projects` (no LLM). Edits to `whatHappens`/premise-level fields show a "structural change — review impact?" affordance that opens Review mode pre-filled. Also lands the deferred PATCH lock guard (§4: patch into locked range → 409 `LOCKED_OBJECT`) and extends it to T1.3's import-as-replace path (locked content in target project → 409; see test plan).
_Accept:_ editing location is silent; editing scene premise offers the Review path; both snapshot.

## Milestone 4 — Review mode (the trust core — do not compress this milestone)

**T4.1 Change Set create.** `POST /change-sets` runs `classify_blast_radius`, annotates `locked`, `applyMode` (scene/beat → regenerate; character/ledgerFact → flag_only), `before` snippets + continuity flags server-side.
_Accept:_ fixture case (scene-2 premise change, prompt spec §3 example) yields impacted list including cross-scene beat-4-2 (`regenerate`) and fact-02 (`flag_only`); locked objects annotated `locked: true`; flag_only objects carry `after: null`.

**T4.2 Preview + apply.** `preview` runs `regenerate_elements` and stores the typed `ChangeSetPreview` payload (`basedOnSnapshotId` = head) without mutating; `apply` writes the stored payload verbatim (zero LLM calls), approved-only, snapshots, re-extracts ledger, then runs `scan_consistency` over untouched scenes (prompt spec §8c). Lock/flag_only violations, null preview, or stale preview → 409; response elements not in request → rejected + logged (`SCHEMA_INVALID_LLM`).
_Accept:_ apply with a locked or flag_only id returns 409 and project unchanged; apply with 2 of 3 approved changes exactly those 2 from the stored payload with no LLM invocation; edit-between-preview-and-apply → `PREVIEW_STALE`; mock scan flags returned in the apply response and persisted as `open` ConsistencyFlags.

**T4.4 Consistency scan plumbing.** `scan_consistency` op wired into apply (T4.2) and beat accept (T2.2); flags CRUD (`GET`, dismiss); amber badges on Plan scene cards; post-apply section in Review UI.
_Accept:_ e2e: apply marina change → post-apply section lists scene-5 tension flag → "Go to scene" lands on scene-5 with amber dot → dismiss clears badge; flags never mutate project state.

**T4.3 Review UI.** Change Set panel per UI spec §5: impacted rows with checkboxes, disabled locked rows with visible lock, before/after diff (plan + script), confidence chips (sage/amber), continuity flags, actions Apply selected / Flag only / Discard (Create branch = disabled with tooltip "v2").
_Accept:_ e2e: trigger scene-premise change → rows render with 1 disabled locked row → uncheck one → preview → diffs visible → apply → board reflects only approved changes; flagged-only leaves project untouched and Change Set `flagged`.

## Milestone 5 — Ledger mode

**T5.1 Ledger UI.** Fact cards per UI spec §6: all fields, click sourceSpan → jumps to beat in Write mode; filters (character, status); review queue (amber) with accept/edit/reject; supersede chain visualization (simple linked list rendering).
_Accept:_ e2e: fixture fact-06 (`pending_review`) shows in queue → edit text → provenance flips to `writer_authored`, status `active`; rejecting removes it from prompt-eligible set (verify via context-bundle snapshot test).

**T5.2 Ledger dual view (Atlas + Knowledge Web).** Client presentation redesign per `docs/superpowers/specs/2026-07-15-ledger-dual-view-design.md`. Story Atlas (chaptered expandable rows), Knowledge Web (character/audience graph), header view switcher with per-project persistence, Lenses rail relabels. No contract/schema/prompt changes.
_Accept:_ (1) Writer can switch Atlas ↔ Web; choice persists for the project after reload. (2) Atlas groups facts by storytelling chapters; rows expand for full metadata and actions. (3) Web shows a character-focused knowledge graph with clickable fact detail and queue actions when pending. (4) Review queue, batch accept, scene batch, source-span → Write, edit/accept/reject, and head refresh after mutations still work. (5) Filters (lenses) affect both views; People selection sets Web focus. (6) No contract/schema/prompt changes; tokens only; `make test` green for touched packages. (7) Empty and filtered-empty states remain clear and on-brand.

## Milestone 6 — Hardening & release gate

**T6.1 LLM evals wired to CI** (test plan §3): schema-validity, lock-violation (must be 0), continuity checks on fixture. Run nightly + on prompt changes. Also: segmentation-determinism eval for `segment_scene`. **Resolution (T6.1):** the segmentation-determinism eval regressed below its soft 0.70 gate under writer-tier segmentation, so the documented escalation was executed — `segment_scene` moved writer→classifier in `apps/api/llm/ops.py`, which runs it at temperature 0 per prompt spec §7 (and the §8 role table in the prompt spec was updated to match). That resolves the temperature/role half of DESIGN-GAP(T6.1); the 0.70 threshold itself remains chosen-not-spec-pinned and flagged for controller/PM ratification (DESIGN-GAP(T6.1) at the eval's gate constant). Continuity remediation: `continuity-grader-0.4.0` keeps the 0.2.0 on-page-learning scope, explicitly treats probing questions/suspicious reactions/exact-amount references as non-disclosure unless learning is established, and uses the pinned writer tier because capture review showed Haiku remained unstable on full-length subtext; `PROMPT_VERSION 0.6.0` added the candidate-template dramatic-irony constraint. Also: wire the CLAUDE.md-mandated `DESIGN-GAP` CI grep (fail unless each occurrence references a task id).
**T6.2 Error/latency polish:** SSE reconnect, `LLM_UNAVAILABLE` toasts, optimistic-update rollback on 409.
**T6.3 Privacy pass:** delete-purge verified (T1.1), no writer text in logs (log IDs + hashes only); product copy states "not used for training" (standard API terms) and does not claim ZDR unless a ZDR agreement is executed (prompt spec §8).
_Release gate:_ all evals green; e2e suite green; a human writes one complete short scene start-to-finish using only the app.

### Remediation tracking (M4/M5 wave — API)

- Null-replacement retirement confirm (ruling 1): stored-null empty `fact`; confirm supersedes target + rejects proposal — landed in remediation/api.
- Locked-scene beat reorder blocked (ruling 2) — landed in remediation/api.
- Change Set GET endpoints (ruling 3) — landed in remediation/api; UI may drop DESIGN-GAP(T4.3) sessionStorage comments once wired.
- DESIGN-GAP(T5.1) edit→active: closed via data-contract §4 note (this remediation).

## Milestone 7 — New-project flow (Story Launcher)

Replaces the hardcoded seeded entry point with a project dashboard, idea/import wizards, and project-scoped resume. Full design in `docs/superpowers/specs/2026-07-10-new-project-flow-design.md`; plan in `docs/superpowers/plans/2026-07-10-new-project-flow.md`. Slices, in order:

**T7.1 Contract + `GET /projects` + dashboard shell.** `ProjectSummary` (Zod↔Pydantic↔data-contract §9.1); `GET /projects` sorted by `updatedAt` desc; Story Launcher dashboard (loading/empty/populated/search-empty/error states). — landed.

**T7.2 Routing cleanup + resume context.** `/projects` is home; mode screens require `?project=` and redirect home otherwise (no seeded fallback); browser-local `tr.resume.v1.<pid>` with stale-scene fallback (design spec §9.5). — landed.

**T7.3 Wizard shell + format presets + drafts.** Shared `WizardShell`, `FORMAT_PRESETS`, versioned browser-local drafts. — landed.

**T7.4 Idea path + foundation-aware create.** `CharacterSeed`/`ProjectFoundationInput`/`ProjectCreateRequest`; atomic root snapshot with optional foundation; `Idempotency-Key` create semantics. No LLM on create. — landed.

**T7.5 Import path + atomic create-and-import + SSE.** `ProjectImportCreateRequest`/`ProjectImportProgressEvent`/`ProjectImportResult`; one root snapshot; named SSE stages; failure creates nothing. — landed.

**T7.6 Guided Plan setup + scene-skeleton Change Set (prompt-changing).** Three-candidate `InitialSceneSkeleton`; select → `initial_scene_skeleton` Change Set → Review; lock-violation test precedes feature tests; bumps `PROMPT_VERSION`. **Requires `make evals` sign-off before merge** (not yet run).

**T7.7 E2E + authority docs + delete UI.** Dashboard overflow **Permanently delete** with typed-title confirmation (`DELETE /projects/{pid}`); Playwright e2e for the five design-spec §12 flows; authority-doc sync. — landed.
_Follow-up (landed with adoption):_ ledger/flag ids are now globally unique `fact-<hex>` / `flag-<hex>` mints (`IdMinter`), so create-and-import no longer collides with the seed's `fact-01…08`.

**T7.8 PDF import MVP.** Add single-episode `.pdf` support to the Import wizard: contract types for `PdfExtractResult`, server-only pypdf text-layer extract with Tesseract OCR fallback, `POST /projects/import/extract-pdf`, editable Confirm source step, and existing create-and-import analyze with the confirmed text as `format: "text"`. — landed.
_Accept:_ text-layer PDF extracts without LLM calls; scanned PDF uses injected/mock OCR on the PR path and system Tesseract in dev; writer can edit extracted text before **Create & analyze script**; import still creates exactly one project/root snapshot only after the analyze trigger; docs include Tesseract bootstrap (`brew install tesseract`; Debian `tesseract-ocr tesseract-ocr-eng`).

**T7.9 Import coverage heal + cost estimate.** Server fills beat-line gaps as `coverage_gap` unassigned; Review/Analyze show scene count, ~2N+1 calls, and Est. $ range from `config/llm_pricing.json`.
_Accept:_ trailing/mid gaps no longer abort import; wizard shows the three estimate figures before Create & analyze. The range-heal implementation is superseded by T7.10's structurally total segment-start partition; the nominal call estimate remains `2N+1`, with a selected scene allowed one quality retry.

**T7.10 Typed segment-start import normalization.** Replace model-owned inclusive beat ranges with typed `beat | unassigned` starts; server derives ends, normalizes semantic start errors, retries severe repairs once per scene, selects the lower lexicographic repair score, and flags every repair in the selected attempt. Bump `PROMPT_VERSION`, regenerate tool schemas, and require `make evals` sign-off. — implemented; real eval sign-off passed for `PROMPT_VERSION` 0.10.0 (schema 1.00/0.98, locks 1.00/1.00, continuity 1.00/0.95 with `continuity-grader-0.4.0`).
_Accept:_ gaps/overlaps are unrepresentable; duplicate/OOB/empty/missing-first/unordered starts never lose or duplicate source text; duplicate/empty/discarded-metadata/>5% repairs trigger exactly one scene retry; the better attempt wins; selected repairs have stable-code flags; lock guard runs before any segmentation call; Zod/Pydantic/data-contract/prompt summary/tool schema remain in sync.

**T7.11 Import-job checkpoint/cache spec.** Specify project-scoped reuse of validated per-scene LLM results across failed/retried atomic imports, including purge, privacy, prompt/model/source hashing, expiry, and no-writer-text logging. Separate infrastructure task; no cache implementation lands in T7.10. — implemented (`import_runs` / `import_run_units`, `Idempotency-Key` resume); content checks, purge and expiry are T9.5.

**T7.12 Parallel import progress.** Run scene-level import analysis with four bounded workers while preserving the deterministic project output: results are applied in source scene order, progress SSE frames report per-scene completion monotonically, and the wizard's stage rows distinguish work-in-progress from truly completed stages.
_Accept:_ segmenting/fact extraction/checking stages use at most four concurrent scene workers; final scenes/beats/facts/flags are ordered exactly as the serial source order requires; progress events for each stage are monotonic (`done` never decreases and never exceeds `total`); a stage shows Done only after every scene assigned to that stage has finished and the next stage is about to begin; import UI shows elapsed time during analysis; ETA appears only after at least 5 scene completions; stale ETA is hidden during long gaps without new completions; any worker/stage failure still emits one terminal `failed` event and creates zero project-scoped rows.

**T7.13 Import act inference + correction.** After per-scene segmentation, infer format-constrained narrative act starts from compact ordered summaries, derive a total scene partition server-side, and let writers correct a scene's act from Plan. `infer_act_breaks` is a synchronized classifier operation; its safe prompt ships at `PROMPT_VERSION` 0.11.0. — implemented; **real full-eval sign-off pending before merge**.
_Accept:_ Zod/Pydantic/tool schemas and authority docs agree on `InferredActBreaks`; all freeform summary text enters prompts only through the nonce-wrapped renderer; starts must begin at scene 0 and strictly increase within format/scene bounds; omitted acts remain empty; every scene gets exactly one act; a schema-valid semantic failure gets exactly one repair and a second failure raises `SCHEMA_INVALID_LLM` with zero persisted project state; SSE stage order includes `inferring_acts`; nominal import cost is `2N+2`; Plan lists exactly the selected format's valid acts, including empty sections; optimistic correction rolls back on failure, obeys scene/episode locks, writes one snapshot, and makes zero LLM/scan calls; hard schema-validity probes include `infer_act_breaks`; the same two labeled half-hour/one-hour cases gate schema/timeout/semantic partition validity at 1.0 in default paid evals; actual transitions (excluding mandatory scene-zero anchors) score the same act within ±2 scenes at a soft ≥0.80 gate; reports/logs contain ids/counts only; non-billable suites pass and the explicitly authorized full real eval is reviewed before merge. Distinct TAG representation/inference and act-heading parsing remain deferred.

**T7.14 Import character mint + knownBy normalize.** Before ledger extraction, mint `seriesBible.characters` from Fountain character cues (heuristic, no new LLM op) and normalize extracted `knownBy` to those character ids so Ledger PEOPLE / Knowledge Web work for every imported project. Spec: `docs/superpowers/specs/2026-07-16-import-character-mint-design.md`. — implemented.
_Accept:_ cue-bearing import yields non-empty `seriesBible.characters` with foundation-shaped shells (`char-{uuid}`); re-import merges speakers without wiping existing/locked characters; persisted import facts’ `knownBy` entries are project character ids (audience tokens dropped, not stored as knowers); no `PROMPT_VERSION` bump; create-and-import still one root snapshot / zero rows on failure; unit + import tests cover cue filter, merge, normalize, and end-to-end mint. DESIGN-GAP(T7.14) resolved by the continuity-layer roadmap (`docs/superpowers/specs/2026-07-16-continuity-layer-roadmap-design.md`), which phases design doc §4.8 step 2 as T7.15–T7.17 below.

**T7.15 Import entity inference (P0).** New classifier op `infer_story_entities` (characters with aliases/roles, relationships, locations/objects with source evidence) runs once per import between act inference and fact extraction; server resolves names, mints ids, merges into `seriesBible` (locked rows untouched); `knownBy` normalization becomes alias-aware. `Character.aliases` added to the contract; new `inferring_entities` SSE stage. `PROMPT_VERSION` 0.12.0 — implemented; **requires `make evals` sign-off before merge** (Task 4 fixture/gates not yet authorized/run). Plan: `docs/superpowers/plans/2026-07-16-import-continuity-mvp.md` Tasks 1–2.
_Accept:_ Zod/Pydantic/data-contract/prompt-spec/tool schemas agree on `StoryEntities`; model mints no ids; schema-invalid output after one retry fails the import atomically (`SCHEMA_INVALID_LLM`, zero rows); alias-bearing mock import resolves `knownBy` names and aliases to one character id; non-speaking planted character lands in the bible; locked characters are never modified by merge; `make check-contract` green.

**T7.16 Cast management (Ledger).** Rename/aliases PATCH, atomic merge (absorbs aliases, rewrites `knownBy`, re-points relationships, one snapshot), and reference-guarded delete; PEOPLE rail management UI with optimistic rollback. Plan: same doc, Task 3.
_Accept:_ each mutation writes exactly one snapshot; merge is atomic (crash leaves either both fact rewrite and character removal or neither); locked source/target ⇒ 409 `LOCKED_OBJECT`; referenced delete ⇒ 409 `VALIDATION` with counts; e2e: merge two duplicate imports and Knowledge Web focus shows the union of facts.

**T7.17 Entity-inference evals.** `fixtures/entity-inference.fountain` with planted aliases, non-speaking character, implied relationships, locations, object; soft gates: entity recall ≥ 0.8, alias resolution ≥ 0.9, zero basis-free entities. Plan: same doc, Task 4. — implemented; `make evals-dry --full` green (both soft families WARN on the seeded Mock, as expected, and never block); **real `make evals` sign-off (0.12.0) still pending explicit authorization**, which also covers T7.15's pending sign-off above.
_Accept:_ eval family wired into `make evals` (`entity-inference` + `alias-resolution`, both soft, in `SOFT_EVAL_KEYS`); non-billable dry-run green; test-plan §1/§3 rows added; real-eval run only on explicit authorization.

**T7.18 Time-aware ledger (as-of scene).** Filter ledger facts to those in force as of a chosen scene using existing `sourceSpan` + supersede semantics — first P1 cut of the continuity-layer roadmap. Spec/plan: `docs/superpowers/specs/2026-07-16-time-aware-ledger-design.md`, `docs/superpowers/plans/2026-07-16-time-aware-ledger.md`. No new LLM op / no `PROMPT_VERSION` bump. — implemented.
_Accept:_ `facts_as_of` unit-tested (later-established out; superseded-after still in; superseded-before out); `GET /ledger?asOfScene=` filters accordingly (unknown scene → 400 `VALIDATION`); Ledger UI As-of control refetches with the param; data-contract + test-plan updated.

**T7.23 Knowledge transitions (P1).** `LedgerFact.knowledgeEvents` + `knowers_as_of` / `knownByAsOf` on `GET /ledger?asOfScene=`; import may populate events. Spec/plan: `docs/superpowers/specs/2026-07-16-time-aware-p1-remainder-design.md`, `docs/superpowers/plans/2026-07-16-time-aware-p1-remainder.md`. `PROMPT_VERSION` 0.13.0 (`extract_ledger_facts` gains an optional `knowledgeEvents` note) — **requires `make evals` sign-off before remote merge** (eval debt, not run per task brief). — implemented.
_Accept:_ `knowers_as_of` unit-tested (learns unions, forgets removes, replays in scene order not list order, orphan `sceneId` skipped); `GET /ledger?asOfScene=` fills `knownByAsOf` per fact, `knownBy` untouched; import resolves `ExtractedFact.knowledgeEvents` `characterNames` → ids against the same running character list as `knownBy` (mint/dedupe/drop-audience); Knowledge Web (`KnowledgeWeb`/`FactCard`) prefers `knownByAsOf` over `knownBy` when set; `make check-contract` green.

**T7.24 Timeline anchors (P1).** Episode `timelineAnchors[]`. — implemented.
_Accept:_ `fountain.timeline.merge_timeline_anchors` is a pure, deterministic (no LLM) scan of each scene's slugline time-of-day suffix — a relative phrase ("Three days later") or absolute clock-time/weekday anchors to the previous scene; bare day-parts (`DAY`/`NIGHT`/`CONTINUOUS`) never anchor; wired into `_install_scenes` so every import (re)computes anchors for the new scene set; unit + import-integration tests; MVP scope: store + `GET /projects/{pid}` only, no dedicated endpoint or UI (design doc — as-of filter stays scene-index-based, anchors never reorder scenes).

**T7.25 Relationship state history (P1).** Episode `relationshipStates[]`. — implemented.
_Accept:_ `merge_inferred_entities` also returns `relationship_states` — one row per resolved relationship's own `evidence` citation from the existing `infer_story_entities` call (no new classifier op, no prompt change); `drama_manager.relationship_as_of.latest_relationship_state` answers "what was this pair's relationship as of scene N" (order-insensitive pair match, latest `sceneId` <= k) for a later Ledger/Web surface — no dedicated endpoint yet; unit + import-integration tests; `make check-contract` green.

**T7.26 Object custody (P1).** Episode `objectStates[]` + conflict flags. — implemented ("simpler MVP" path from the design doc).
_Accept:_ `fountain.object_states.infer_object_states` is a deterministic, no-new-LLM text scan over already-extracted state/event ledger facts for one narrow custody phrasing ("X is hidden/kept/stored/located in/at/under/behind Y"); `holderCharacterId` stays null in this cut (location-only signal). `detect_object_conflicts` flags a later scene whose location for the same object (case/article-insensitive name match) disagrees with its most recent earlier state, in scene order — surfaced as an open `tension` `ConsistencyFlag` after import, same source-of-flags convention as the consistency scan and segmentation-repair flags. Unit + import-integration tests; `make check-contract` green.

**P1 exit (continuity-layer roadmap):** with T7.18 (as-of scene) + T7.23 (who knew it, as of scene N) landed, the ledger now answers the roadmap's stated exit criterion — _"what was true, and who knew it, as of scene N"_ — and T7.24–T7.26 round out the remaining P1 bullets (timeline anchors, relationship states, object custody) at MVP/display-only scope. P1 is closed; P2 narrative-promises (T7.19–T7.22 below) is now implemented end to end (contract → inference → UI → evals), with real `make evals` sign-off on `PROMPT_VERSION` 0.14.0 still outstanding pending authorization (eval debt).

**T7.19 Narrative promises contract (P2).** `StoryThread` on `Episode`, structured `WorldRule` fields, §2a `NarrativePromises`, import stage `inferring_promises`. Spec/plan: `docs/superpowers/specs/2026-07-16-narrative-promises-design.md`, `docs/superpowers/plans/2026-07-16-narrative-promises.md`. — implemented.
_Accept:_ Zod/Pydantic/data-contract/prompt-spec/tool schemas agree; fixture validates with `threads: []` and worldRule defaults; `make check-contract` green.

**T7.20 Import narrative-promises inference.** Classifier op after entity inference; merge threads/motivations/world rules; `PROMPT_VERSION` 0.13.0 → **0.14.0** — **requires `make evals` sign-off before remote merge** (eval debt, not run per task brief). Plan Task 2. — implemented.
_Accept:_ mock import yields threads with resolved owners + setup scenes; motivations land on scenes; locked world rules untouched; atomic fail on schema-invalid after one retry.

**T7.21 Ledger Threads panel.** List open/paid_off/abandoned with setup/payoff scene jump. Plan Task 3. — implemented.
_Accept:_ Vitest covers render + navigation affordance; tokens only.

**T7.22 Narrative-promises evals.** Planted fixture + soft recall gates; dry-run only until authorized. Plan Task 4. — implemented.
_Accept:_ `fixtures/narrative-promises.fountain`/`.planted.json` plant exactly one setup/payoff thread, one open thread, one scene motivation, and one world rule with a `limit`; `narrative-promises` (prompt-level recall, hallucination-penalized) and `narrative-promises-merge` (real `merge_narrative_promises` resolution) soft families wired into `evals/suite.py`/`run.py`'s `--full`/`--only`; `make evals-dry` (`python -m evals.run --dry-run --full`) exits 0. Real `make evals` sign-off remains outstanding — **not run** per task brief; tracked as eval debt alongside T7.20's `PROMPT_VERSION` 0.14.0 bump.

**T7.27 Story overview contract.** Add `Episode.storyOverview` (`StoryOverview` + outline/beat items), §2a `InferredStoryOverview`, import stage `inferring_overview` after `inferring_promises`. Spec/plan: `docs/superpowers/specs/2026-07-17-import-story-overview-design.md`, `docs/superpowers/plans/2026-07-17-import-story-overview.md`. — implemented.
_Accept:_ Zod/Pydantic/data-contract/prompt-spec stub/tool schemas agree; fixture validates with `storyOverview: null`; `make check-contract` green; no pipeline behavior change yet.

**T7.28 Import `infer_story_overview`.** Now on `import_analyst` (Opus 5) with the other import story-breakdown ops (segment / acts / entities / promises); merge onto episode; backfill empty `Project.premise` / `Episode.premise` from logline; preserve locked overview on re-import; `PROMPT_VERSION` 0.14.0 → **0.15.0** (later content bumps through **0.18.0**; Opus role pin is a model-path change with prompt text unchanged) — **requires `make evals` sign-off before remote merge** (do not run until authorized). Plan Task 2. — implemented.
_Accept:_ mock import fills logline/outline/beatSheet/summary; empty premises gain the logline; locked overview preserved; schema-invalid after retry fails import with zero rows; unit + import tests.

**T7.29 Ledger Overview panel.** FilterRail Overview entry + `OverviewPanel` (logline, summary, outline, beat sheet) with scene/beat jumps; optional header logline teaser; tokens only; Vitest. Plan Task 3. — implemented.
_Accept:_ imported project shows overview; empty state when absent; jumps land in Write; no contract change beyond display.

**T7.30 Story-overview evals.** Planted fountain + JSON; soft gates for logline presence, outline scene-coverage, beat-sheet coverage, two-paragraph shape; dry-run wired; real `make evals` only when authorized. Plan Task 4. — implemented (dry-run path; real evals not run).
_Accept:_ families in `--full` / `--only`; dry-run green; test-plan rows added; **`make evals` not run**.

**T7.30a TV beat-sheet grounding.** Optional `act` on overview beat rows; prompt feeds format + act-ordered spine + beat `whatHappens`; merge resolves `sceneId`/coerces `act`/sorts/dedupes; `PROMPT_VERSION` 0.15.0 → **0.16.0**; planted STC-label + act checks. Spec amendment on `2026-07-17-import-story-overview-design.md`. — implemented (dry-run OK; **`make evals` not run** until authorized).

**T7.30b Overview content quality.** Prompt **0.17.0** bans location-theater boilerplate and requires names/concrete events; pipeline feeds learns/feels/scriptExcerpt + known_cast; merge soft-replaces boilerplate with beat `whatHappens`; `max_tokens` 16384; outline UI leads with action. Spec amendment on same design doc. — implemented (**`make evals` not run** until authorized).

**T7.30c Overview TV-label harden + Tag module.** Prompt **0.17.0 → 0.18.0**: stronger film/STC ban list (Inciting Incident / Midpoint / Climactic Reversal / Act Two Opening + STC-15); positive TV-only exemplars; Tag = last module. Merge rewrites banned labels → Act N Turn, clears Tag act for TAG cue, Cold Open → act 0, soft-replaces cross-scene location drift with beat `whatHappens`; OverviewPanel renders real summary paragraphs (incl. literal `\\n\\n`) and TAG cue. — implemented (**`make evals` not run** until authorized).
_Accept:_ mock/unit/import tests green; `make check-contract` green; Overview formatting preserved; real evals deferred.

**T7.31 Ledger character profile (People).** `Character.summary` + `Character.bio` (defaults `""`); import merge copies inferred `traits` into empty `traits`/`summary`; Ledger shows profile header (name, aliases, summary, bio) above Atlas/Web when a person is selected, with deterministic fallback from craft fields then knownBy facts + motivations (no second LLM call; no tool-schema / `PROMPT_VERSION` change). Spec: `docs/superpowers/specs/2026-07-17-ledger-character-profile-design.md`.

_Accept:_ People selection shows summary + bio (stored, bible, or derived); empty state when none; existing imports work without re-import via derive; `make check-contract` green; Vitest + API merge tests; no `make evals`.

**T7.32 Evidence-grounded narrative map.** Add `Episode.narrativeMap` plus `InferredNarrativeMap`, an explicit post-import Narrative Map action, and a Ledger card for macro structure (acts/themes/central dramatic question), optional Hero's Journey, character wants/needs/conflicts/arcs, scene turns, and thread movement. The model must cite source beat IDs; the server derives exact beat-text excerpts, covers every act and scene, resolves character/thread references server-side, preserves locks, and retries once on semantic grounding failure. `infer_narrative_promises` receives the beat-complete source spine so thread discovery can see late-scene evidence. `PROMPT_VERSION` 0.20.0; required real-eval gate is recorded in the test plan. Spec: `docs/superpowers/specs/2026-07-23-narrative-map-design.md`. — implemented; real eval not run without authorization.

**T7.32a Coverage excludes unwritten scenes (P1).** "Covers every act and scene" now reads *every act and scene that has source*. A scene with no beats, or whose beats all lack `scriptText`, is a stub the writer has not written yet — a normal Plan-mode state the UI spec documents ("Empty scene (no beats)") and one the committed fixture deliberately carries in `scene-6` and `beat-5-1`. Readiness previously rejected the whole episode on one such scene, which contradicted its own rule to "reject only true source gaps ... not a reason to abandon the writer" and made the Narrative Map impossible to exercise against the fixture at all. `drama_manager.narrative_map.scene_has_no_source` is the single predicate: `prepare_narrative_map_source` excludes those scenes from analysis and records them on `NarrativeMapSource.stub_scene_ids` (never silently dropped), and `merge_narrative_map` excludes them from act and scene-turn coverage, since a claim about a scene with no source could never be verified. An episode with *no* source-backed scene at all is still a hard `no_source_backed_scenes` failure, and a single unwritten beat inside an otherwise-written scene is skipped rather than failing the scene. — implemented.
_Accept:_ Zod/Pydantic/data-contract/prompt-spec/tool schema agree; map evidence is source-grounded; scene/act coverage and locks are enforced; import progress/cost are updated; Ledger has evidence jumps; focused API/Vitest checks pass; no `make evals` without authorization.

## Milestone 8 — Fabula adoption (P-MVP slices)

See `docs/tableread-adoption-prd.md` for full A1–A10 requirements. Sequencing table there maps items onto earlier milestones; remaining P-MVP work lands here as explicit tasks.

**T8.1 JSON export (A6-MVP).** `GET /projects/{pid}/export.json` returns the `PersistedState` envelope; Settings → **Export project JSON**; round-trip purge/re-seed restores project doc + ledger byte-identical. — landed.

**T8.2 Undo timeline dropdown (A5).** `GET /projects/{pid}/snapshots` + `POST /projects/{pid}/restore`; Undo ▾ lists ~20 ancestors (instruction + relative time); restore is ancestor-of-head only; empty instruction rejected. — landed.

**T8.3 Suggestion carousels (A4) + Write keyboard (A8).** `POST /suggest` + chips on command bar / Tune / scene what-happens; Write shortcuts Q/W/Tab/Enter/Esc/1–3 (disabled while canvas focused). Prompt `build_suggest_prompt` bumps `PROMPT_VERSION` to 0.8.0 — **needs `make evals` sign-off**. — landed (evals pending).

**T8.4 Lock-repair prompt + import/subtext evals (A1, A2, A10).** Shared-system HARD RULES for lock-aware narrative repair + subtext fidelity (`PROMPT_VERSION` 0.9.0); `fixtures/import-inference.fountain` + planted JSON; soft evals `lock-repair` / `import-inference` / `subtext` wired into `make evals`. — landed (**needs `make evals` sign-off**).

**T8.5 Craft-level picker (A3 / P-v2).** `Project.defaultCraftLevel`; `craftLevel` on candidate SSE + Change Set preview; Fast (1) / Standard (3) / Considered (drafts + polish, no new LLM ops); Write dock + Review preview + Settings picker. — landed.

**T8.6 Workflow-recipe onboarding (A9 / P-v2).** `recipes.json` + `?tour=` overlay highlighting real controls; dashboard recipe picker + first-run; e2e walks each recipe on the seeded fixture. — landed.

## Milestone 9 — Resilient import & breakdown

The server computes what the page states outright (scene boundaries, printed act markers, cast from dialogue cues, quote positions); the model only interprets on top; the server checks what comes back and may flag or drop but never invents; the writer sees an honest report of what was and was not analysed. Source: the 2026-09-28 resilience design review (its §2 figures are corrected here: 44 published Americans fallback turns, and 74% West Wing / 88% Americans unlocated fact quotes); owner decisions in handoff §4 (2026-10-04). No task here changes a tool schema or `render.py` template text. T9.5 lands before T9.6 (checkpoints are keyed by scene index).

**T9.1 Never reuse a fallback scene packet (plan 1.1).** `reusable_scene_packets` excludes every packet in any prior run checkpoint's `fallbackSceneIds` or with `analysisStatus == "source_fallback"`, and carries `analysisStatus` through reuse (run 2.6 reused all 44 of run 2.5's fallback packets with the marker stripped).
_Accept:_ a three-run chain (fallback run → reusing run → third run) reuses no fallback packet; a reused packet keeps its `analysisStatus`.

**T9.2 Publish a verdict whose blocking claims were all withdrawn.** Fix the 5b6ab04 bug: after `partition_self_retracted_claims` moves every blocking claim to advisories, `validate_verification` still rejects on `approved=False` with a pathless, reasonless `verifier_rejected`, and retry is then blocked at that analysis version.
_Accept:_ reproduced first (`approved=False` + one `unsupportedClaim` with `excerptCarriesClaim=True`, partitioned then validated, raises); no blocking claims and no missing scenes after the server's partition ⇒ publishes; `approved=True` with a blocking claim still rejects; a raw `approved=False` verdict with empty lists has a tested outcome derived from the lists, and every rejection carries a reason; end-to-end `execute_run` test with `MockLlmClient` for the all-withdrawn case.

**T9.3 Show failed map scenes as unanalysed (owner decision 2; plan 2.2 + 1.11).** A map scene that still fails after one same-prompt re-roll is listed in a persisted `NarrativeMap.unanalyzedSceneIds` and gets no sceneTurn; fallback prose is no longer published.
_Accept:_ `unanalyzedSceneIds` in Zod (default `[]`), Pydantic and the data contract, with `InferredNarrativeMap` and tool schemas unchanged; merge coverage accepts "analysed or listed unanalysed"; synthesis spine and audit evidence exclude unanalysed scenes; the fallback publisher is removed or uncalled (rule 9); `NarrativeMapCard` lists unanalysed scenes plainly and offers to analyse them through the existing Generate path, reusing analysed packets, with retry allowed on a completed run that has unanalysed scenes and labelled as costing model calls; `isUsableNarrativeMap` still shows such a map; a one-off migration through `snapshots.mutate` converts published fallback turns to unanalysed and is dry-run only on a DB copy (expected 44 on the Americans); `NARRATIVE_MAP_ANALYSIS_VERSION` bumped.

**T9.4 Stop hidden SDK retries; back off only on overload (plan 1.2).** App and eval Anthropic clients use `max_retries=0`, pass the op timeout per request, and `_create_with_timeout` / `_stream_final_with_timeout` add exactly one explicit backoff retry for 429, 529 and 5xx (not billed); never after a timeout. _(Superseded 2026-10-13 by the Phase 1 import speed-ups: up to 4 attempts, honoring `retry-after`, else 2/4/8 s backoff with ±20% jitter, at most 60 s of waiting in total; still never after a timeout or a 504.)_
_Accept:_ fake-SDK tests: a 529 then success returns one result after one retry; a timeout is not retried; a 400 is not retried; the per-op 180s/300s budgets replace the SDK's 120s read timeout.

**T9.5 Content-checked, version-aware import checkpoints (plan 1.3; completes T7.11).** Saved import units are reused only when they match the current scene text, prompt and models; failed-run units expire.
_Accept:_ a segment unit is reused only if its joined beat `script_text` equals the current scene span's text; extract units are keyed by a scene hash; the effective version folds `PROMPT_VERSION` and a `config/models.toml` hash into `IMPORT_ANALYSIS_VERSION`; failed-run units are purged after a fixed number of days and on project delete (they hold verbatim script text); `MockLlmClient` test per rule.

**T9.6 Recognise numbered and forced scene headings (plan 1.4).** `_SLUGLINE_RE` accepts production scene-number prefixes and suffixes, Fountain forced headings (one leading `.` then a non-`.`) and `EXT/INT.`, and stops matching mixed-case action prose; the `characters.py` twin is deleted and the rule mirrored in `importSourceStats.ts`; `slugline_time` strips scene numbers and accepts `--`, `—`, `–` and `~`.
_Accept:_ `17 INT. OFFICE - DAY 17`, `A12 EXT. STREET - NIGHT` and `.FLASHBACK` are headings and `Ext. is short for exterior.` is not; `IMPORT_ANALYSIS_VERSION` bumped, with a test that resuming a failed run across a changed split reuses no units; read-only re-split probe of the 4 stored projects reports West Wing 27 → 29, others unchanged.

**T9.7 Use printed act markers instead of guessing acts (owner decision 3; plan 2.1 + 1.8).** `acts_from_markers` (TEASER/COLD OPEN, ACT ONE…, END OF ACT …) supplies the act partition when it is valid and consistent with `format.actCount`; `infer_act_breaks` runs only otherwise.
_Accept:_ synthetic scripts: valid markers make zero `infer_act_breaks` calls; partial or inconsistent markers fall back to exactly today's call; data contract §9.3 step 2 and the prompt spec say `infer_act_breaks` runs only when markers are absent or invalid; `IMPORT_ANALYSIS_VERSION` bumped; read-only probe reports West Wing markers against its stored acts, and the Americans.

**T9.8 One record per person, no camera directions as cast (plan 1.7).** Alias-aware character merge, grounded and filler-gated `normalize_known_by`, a cue counts only when dialogue follows it, and whole-phrase `is_generic_role`.
_Accept:_ "Joshua Lyman" attaches to "Josh"; "Mallory O'Brien" with existing "Mallory" and "O'Brien" files a merge-proposal flag pointing at the T7.16 merge-into flow; ledger extraction cannot mint "<unknown>" or "All reporters present"; the cue rule applies only when most of the script's cues satisfy it; read-only probe reports junk-row reduction with no real speaker lost (plan measured −38 Number_Two, −6 Americans); `IMPORT_ANALYSIS_VERSION` bumped if import output changes.

**T9.9 Locate evidence quotes on the page (plan 1.5).** One shared `locate_quote` (reported line window, then whole beat; `html.unescape`, typographic fold, whitespace collapse, page furniture skipped, index map back to original offsets) sets offsets only, for ledger facts and `relationshipStates`; `parse.locate_source_text` is deleted and its tests moved.
_Accept:_ `verify_source_text` stays window-strict and alone decides activation (test: an out-of-window quote is still demoted); no per-quote flags; read-only probe reports located counts on the stored projects (plan measured West Wing 29 → 107/115, Americans 55 → 354/470); `IMPORT_ANALYSIS_VERSION` bumped.

**T9.10 Retry a scene that returns no beats or leaked markup (plan 1.6).** `should_retry` also fires on leaked tool-call markup and on an all-unassigned result for scenes over a line threshold (existing single retry); `_segment_one` ranks such attempts worst; what went wrong reaches the retry through diagnostics/source_data, not template text.
_Accept:_ a retry with beats replaces an all-unassigned first attempt; markup is never stored (blanked and flagged if it survives the retry); short establishing scenes get no `no_beats_returned` flag; the "Re-run the breakdown" flag text is reworded to something the app can do; `IMPORT_ANALYSIS_VERSION` bumped.

**T9.11 Continue an import past a failed scene (owner decision 1; plan 2.7).** A segmentation unit that fails after its rule-9 retry degrades to the verbatim `no_beats_returned` beat, and an extraction unit to zero facts, each with an open flag naming the scene; acts and every other whole-script stage stay required.
_Accept:_ `MockLlmClient`: one scene failing twice still completes the import with that scene flagged and the others intact; an acts failure still aborts with zero rows; nothing is fabricated; data contract §9.3 (atomic import) updated; `IMPORT_ANALYSIS_VERSION` bumped.

**T9.12 Pick map evidence quotes by substance, not position (plan 1.9, quotes).** Every display-quote site in `drama_manager/narrative_map.py` cites `quote_for_beat(scene, id)[0] or _source_quote(beat)`; `_source_quote` stays the presence gate in `_grounded_beat`.
_Accept:_ call sites counted precisely (a review found 10, not 7) and all converted; read-only replay of both stored maps shows zero new empty quotes, with a committed synthetic version of that test; `NARRATIVE_MAP_ANALYSIS_VERSION` bumped.

**T9.13 Harden verifier paths, failure handling and theme repair (plan 1.9, verifier and failures).** Verifier paths are cleaned before resolving, the map-run catch-all is split by error kind, a synthesis-phase schema failure can resume, and theme repair removes only the bad citation.
_Accept:_ `themes[0].evidence[0] (beat-10-1)` resolves and a claim filed in both lists is advisory; `APITimeoutError` → `LLM_TIMEOUT` (10-minute grace kept); 429/529/5xx and non-timeout connection errors → `LLM_UNAVAILABLE`, resumable from checkpoints on the writer's click; other 4xx terminal with a clear message; anything else a non-retryable bug; a synthesis-phase `SCHEMA_INVALID_LLM` resume reuses checkpointed scene packets and re-runs only synthesis (same prompt); `EVIDENCE_REJECTED` stays blocked; a theme is dropped only when its evidence empties; tests per part; `NARRATIVE_MAP_ANALYSIS_VERSION` bumped if output changes.

**T9.14 Honest import report and unlocated-quote label (owner decision 4; plan 1.10).** A client-side import report built from the `ProjectImportResult` the wizard already receives shows before the redirect to the Ledger Story tab, and the same pure function drives a Plan banner for existing projects; `FactDetailDrawer` labels unlocated quotes.
_Accept:_ report lists empty beats, unlocated quotes, flag counts by code and act-marker disagreement, with no contract change; "Quote not verified against the page" appears only when `sourceText` is non-empty and `charStart` is null (supersede proposals and writer-authored facts unlabelled); "Accept all high-confidence" unchanged; a backfill through `snapshots.mutate` sets `charStart` with T9.9's `locate_quote` and rewrites open "Re-run the breakdown" flags to T9.10's wording, dry-run only on a DB copy with counts reported; tokens only; Vitest beside the components; `make e2e` owed before merge.

**T9.15 Relationship-quote offsets (open question from T9.9; blocks T9.9 done).** T9.9 asks for `locate_quote` offsets on `relationshipStates` quotes, but `RelationshipState` is `{between, label, sceneId, quote}` with no offset fields, and its evidence names a scene, not a beat or line window. Owner to choose: (a) add nullable `charStart`/`charEnd` to `RelationshipState` (Zod, Pydantic, data contract; not a tool schema), counted into the scene's beats joined with `"\n"` and set by `locate_quote` with no window; or (b) drop `relationshipStates` from T9.9.
_Accept:_ the owner's choice is recorded here; for (a), a unit test and `make check-contract`; the `DESIGN-GAP(T9.15)` in `fountain/characters.py` is removed.

**T9.16 Short establishing scene threshold (open question from T9.10).** T9.10 exempts short establishing scenes from the `no_beats_returned` retry and flag but does not say how short. Shipped default: at most 2 non-blank lines and at most 130 characters after the heading (the stored hard-wrapped short scenes top out at 128; native Fountain puts a whole action paragraph on one line, so a line count alone would silence a real two-paragraph scene). Owner to confirm or replace the numbers.
_Accept:_ the owner's numbers are recorded here and in prompt spec §import; the `DESIGN-GAP(T9.16)` in `fountain/parse.py` is removed.

**T9.17 Read a scene's beats on the import board (owner decision 2026-10-13, import speed plan round 2 §5 option A).** The `found` `scene` frame carries each beat's `whatHappens`, `audienceLearns` and `audienceFeels` (`beats`, default `[]`; never `scriptText`), and a read card on the board opens a reading view of its beats while the import keeps running.
_Accept:_ `beats` in Zod, Pydantic and data contract §9.3, `check_contract` passes, no tool-schema or prompt change; pytest: the frame carries the post-merge reading fields, no frame contains a `scriptText` key or a script line, cached re-emits carry the beats, a failed unit sends `beats: []`, logs stay kind and counts; a read card is a real button ("Read scene N"), still-reading and failed cards are not; the view opens beside its card without reflowing the grid, closes on Esc, Close or the card again with focus back on the card, and works at the finale (Open your story still focused) and when Stopped; tokens only, reduced motion respected; Vitest and the import e2e cover it.

**T9.18 Import call diagnostics and per-model caps (round-2 import speed plan §4).** Every import `llm_call` line carries the run id (pool workers included), stage, scene, queue time, calls in flight, the rate-limit headers, the size of the structured output and the request id (streamed calls too); billing and spend-limit errors fail fast; `TABLEREAD_IMPORT_CONCURRENCY_SONNET` / `_HAIKU` cap each fan-out by its op's model; the diagnostics log moves from /tmp to `apps/api/logs/`; the wizard's cost estimate is rebuilt from the current pipeline.
_Accept:_ fake-SDK and `MockLlmClient` tests: a call from a pool worker (serial and overlap) logs the run id and its unit; the new fields are numbers, ids or `-`, never text; a 402 `billing_error`, a 429 with `enforced_spend_limit_reached` and a 400 own-spend-limit are not retried while an ordinary 429 still is; per-model caps fall back to `TABLEREAD_IMPORT_CONCURRENCY`, then 8, clamped 1–16, defaults unchanged; the log path is gitignored and ignored by `uvicorn --reload`; the estimate brackets ~$2.64 for 54–68 scenes of ~37k characters; no prompt, schema or model change.

**Deferred (paid).** Plan items 3.1 (motivations cite an evidence beat; server derives the quote), 3.2 (one typed verifier verdict per server-listed claim), 3.3 (knowledge-layer typed fields) and 3.4 (per-scene re-breakdown, then promises, overview and a full map re-run) each change a tool schema or spend model calls and wait for authorization. Eval debt owed: scoped `make evals` sign-off with `--only schema --runs 1` and `--only act-validity --runs 1` for `PROMPT_VERSION` 0.46.0–0.48.0 — not run.

## Sequencing & parallelism

```
M0 (all parallel) → M1 → M2 & M3 in parallel → M4 → M5 → M6
```

Agents must not start M4 before M2.2 lands (Change Sets reuse the regeneration + ledger plumbing). UI tasks (T2.3, T3.1, T4.3, T5.1) can be built against the mock API as soon as T1.2 exists.
