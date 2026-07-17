# Table Read MVP Build Plan

Ordered milestones, agent-sized tasks, acceptance criteria. Reference docs: design doc (`narrative-sidekick-design-doc.md`), data contract, prompt spec, UI spec, test plan, fixture (`tableread-fixture.json`). Single-user, single-episode, four modes (design doc §8).

**Definition of done (every task):** typed against the data contract; unit tests pass; no direct Anthropic calls in tests (mock client); lint clean; fixture-based e2e for UI tasks; task's acceptance criteria demonstrably met.

## Milestone 0 — Scaffold (parallel-safe)

**T0.1 Repo scaffold.** Monorepo: `apps/web` (React 18 + TS + Vite + Tailwind), `apps/api` (FastAPI + Python 3.12 + SQLAlchemy + SQLite), `packages/contract` (Zod schemas + generated TS types). Root `CLAUDE.md`, `Makefile` (`make dev|test|lint|check-contract`).
*Accept:* `make dev` boots both apps; `make test` green on empty suites.

**T0.2 Contract implementation.** Zod schemas + Pydantic mirrors + `scripts/check_contract.py` per data contract §5.
*Accept:* fixture JSON validates against both sides; intentional field rename fails `make check-contract`.

**T0.3 Fixture + seed.** Load `tableread-fixture.json` via `make seed`. The fixture is a **persisted-state envelope** (`project`, `ledger`, `snapshots` with root `snap-root`, plus empty `consistencyFlags`/`changeSets`/`suggestionHistory`) — seed writes each key to its store verbatim.
*Accept:* GET `/projects/{pid}` returns the fixture project with `headSnapshotId: "snap-root"`; ledger endpoint returns its 8 facts; snapshots table has exactly the root row, whose `doc`/`ledger` match the live stores; undo immediately after seed → 409 (root has no parent).

**T0.4 Design tokens.** Tokens from UI spec §1 as CSS variables + Tailwind theme.
*Accept:* Storybook (or a `/tokens` dev page) renders swatches for all tokens, light theme.

## Milestone 1 — Project core (API-first)

**T1.1 Project CRUD + snapshots.** `POST/GET/PATCH /projects`, snapshot-per-mutation, `POST /undo`, `DELETE` purge.
*Accept:* PATCH → new snapshot + head bump in one transaction; undo restores prior doc byte-identical; delete leaves zero project-scoped rows across **all six DB tables plus embeddings** (`projects`, `snapshots`, `ledger_facts`, `change_sets`, `consistency_flags`, `suggestion_history`).

**T1.2 Mock LLM client + Anthropic client.** `LlmClient` protocol; `MockLlmClient` replays canned responses keyed by operation + fixture inputs; `AnthropicClient` with tool-forced JSON, one schema-retry, `PROMPT_VERSION` logging.
*Accept:* all ops callable against mock; retry path unit-tested (first response invalid → second valid); tests never hit network.

**T1.3 Fountain export + import.** Export walks scenes/beats emitting `scriptText`; import = full transaction per data contract §4: two-stage parse (prompt spec §7) → ledger extraction over imported scenes (all facts `pending_review`) → initial consistency scan → one snapshot committing doc + ledger + flags.
*Accept:* fixture exports to valid Fountain (round-trips through `fountain-js` parse); importing that export reproduces scene/beat count and returns `{project, newFacts, consistencyFlags}` with every imported fact `pending_review`; typed segment starts normalize to a total partition per T7.10; unassigned/repair ranges are preserved in scriptText and flagged; reconstructed text is byte-identical to source; a mid-transaction failure leaves zero rows changed.

## Milestone 2 — Write mode

**T2.1 Candidate generation endpoint.** SSE per data contract; sequential diversity calls; context bundle per prompt spec §1 (ledger filtering, locked beats, token budget).
*Accept:* streams 3 `candidate_done` events with schema-valid `BeatCandidate`s against mock; a mock invalid candidate emits `candidate_failed`, not a partial card; context bundle snapshot-tested (locked beat text present, facts filtered by `isPromptEligibleFact` — prompt spec §8, all freeform fields wrapped in `<source_data kind="...">` tags, ≤6k tokens on fixture); cards actionable only after `candidate_done`.

**T2.2 Accept/Tune/Skip + ledger hook.** Accept inserts beat + snapshot + fires `extract_ledger_facts` and `scan_consistency`; tune endpoint; skip is client-side.
*Accept:* accepting fixture candidate adds beat with correct `index`; new facts land `pending_review` when confidence <0.8, else `active`; contradiction creates supersede proposal without overwriting (fact-07 case from prompt spec); mock scan flags surface in the accept response.

**T2.3 Write mode UI.** Script canvas (teleplay CSS), right candidate cards with labels + Accept/Tune/Skip, bottom command bar, streaming text. States per UI spec §3: empty, streaming, error.
*Accept:* e2e (Playwright + mock API): open fixture scene-3 → "Next Beat" → 3 labeled cards stream in → Accept → beat appears in script → ledger badge increments. AI controls invisible while textarea focused (spec §3).

**T2.4 Write script home.** Episode-continuous scrollable script + left scene outline + active-scene generation target (design: `docs/superpowers/specs/2026-07-14-write-script-home-design.md`). Client-only; Plan remains structural. No contract/prompt changes.
*Accept:* Write shows a scrollport with all episode scenes stacked; outline lists every scene and click jumps + highlights active; Next Beat / command bar use active scene; `[`/`]` step scenes when not typing; `?scene=` / Ledger `highlightBeat` still land correctly; unit tests for outline, stacked canvas, WriteScreen scrollport.

## Milestone 3 — Plan mode (simplified board)

**T3.1 Board UI.** One episode: act columns (or rows) as frames, scene cards, expandable beat cards; select → right inspector (fields per UI spec §4); lock toggles; drag to reorder scenes (PATCH index swap).
*Accept:* e2e: reorder scene-4 before scene-3 persists after reload; lock icon renders on beat-1-2 (locked in fixture); inspector shows motivations + affected ledger facts (facts whose sourceSpan is in the selected scene).

**T3.2 Direct edits.** Inspector field edits → `PATCH /projects` (no LLM). Edits to `whatHappens`/premise-level fields show a "structural change — review impact?" affordance that opens Review mode pre-filled. Also lands the deferred PATCH lock guard (§4: patch into locked range → 409 `LOCKED_OBJECT`) and extends it to T1.3's import-as-replace path (locked content in target project → 409; see test plan).
*Accept:* editing location is silent; editing scene premise offers the Review path; both snapshot.

## Milestone 4 — Review mode (the trust core — do not compress this milestone)

**T4.1 Change Set create.** `POST /change-sets` runs `classify_blast_radius`, annotates `locked`, `applyMode` (scene/beat → regenerate; character/ledgerFact → flag_only), `before` snippets + continuity flags server-side.
*Accept:* fixture case (scene-2 premise change, prompt spec §3 example) yields impacted list including cross-scene beat-4-2 (`regenerate`) and fact-02 (`flag_only`); locked objects annotated `locked: true`; flag_only objects carry `after: null`.

**T4.2 Preview + apply.** `preview` runs `regenerate_elements` and stores the typed `ChangeSetPreview` payload (`basedOnSnapshotId` = head) without mutating; `apply` writes the stored payload verbatim (zero LLM calls), approved-only, snapshots, re-extracts ledger, then runs `scan_consistency` over untouched scenes (prompt spec §8c). Lock/flag_only violations, null preview, or stale preview → 409; response elements not in request → rejected + logged (`SCHEMA_INVALID_LLM`).
*Accept:* apply with a locked or flag_only id returns 409 and project unchanged; apply with 2 of 3 approved changes exactly those 2 from the stored payload with no LLM invocation; edit-between-preview-and-apply → `PREVIEW_STALE`; mock scan flags returned in the apply response and persisted as `open` ConsistencyFlags.

**T4.4 Consistency scan plumbing.** `scan_consistency` op wired into apply (T4.2) and beat accept (T2.2); flags CRUD (`GET`, dismiss); amber badges on Plan scene cards; post-apply section in Review UI.
*Accept:* e2e: apply marina change → post-apply section lists scene-5 tension flag → "Go to scene" lands on scene-5 with amber dot → dismiss clears badge; flags never mutate project state.

**T4.3 Review UI.** Change Set panel per UI spec §5: impacted rows with checkboxes, disabled locked rows with visible lock, before/after diff (plan + script), confidence chips (sage/amber), continuity flags, actions Apply selected / Flag only / Discard (Create branch = disabled with tooltip "v2").
*Accept:* e2e: trigger scene-premise change → rows render with 1 disabled locked row → uncheck one → preview → diffs visible → apply → board reflects only approved changes; flagged-only leaves project untouched and Change Set `flagged`.

## Milestone 5 — Ledger mode

**T5.1 Ledger UI.** Fact cards per UI spec §6: all fields, click sourceSpan → jumps to beat in Write mode; filters (character, status); review queue (amber) with accept/edit/reject; supersede chain visualization (simple linked list rendering).
*Accept:* e2e: fixture fact-06 (`pending_review`) shows in queue → edit text → provenance flips to `writer_authored`, status `active`; rejecting removes it from prompt-eligible set (verify via context-bundle snapshot test).

**T5.2 Ledger dual view (Atlas + Knowledge Web).** Client presentation redesign per `docs/superpowers/specs/2026-07-15-ledger-dual-view-design.md`. Story Atlas (chaptered expandable rows), Knowledge Web (character/audience graph), header view switcher with per-project persistence, Lenses rail relabels. No contract/schema/prompt changes.
*Accept:* (1) Writer can switch Atlas ↔ Web; choice persists for the project after reload. (2) Atlas groups facts by storytelling chapters; rows expand for full metadata and actions. (3) Web shows a character-focused knowledge graph with clickable fact detail and queue actions when pending. (4) Review queue, batch accept, scene batch, source-span → Write, edit/accept/reject, and head refresh after mutations still work. (5) Filters (lenses) affect both views; People selection sets Web focus. (6) No contract/schema/prompt changes; tokens only; `make test` green for touched packages. (7) Empty and filtered-empty states remain clear and on-brand.

## Milestone 6 — Hardening & release gate

**T6.1 LLM evals wired to CI** (test plan §3): schema-validity, lock-violation (must be 0), continuity checks on fixture. Run nightly + on prompt changes. Also: segmentation-determinism eval for `segment_scene`. **Resolution (T6.1):** the segmentation-determinism eval regressed below its soft 0.70 gate under writer-tier segmentation, so the documented escalation was executed — `segment_scene` moved writer→classifier in `apps/api/llm/ops.py`, which runs it at temperature 0 per prompt spec §7 (and the §8 role table in the prompt spec was updated to match). That resolves the temperature/role half of DESIGN-GAP(T6.1); the 0.70 threshold itself remains chosen-not-spec-pinned and flagged for controller/PM ratification (DESIGN-GAP(T6.1) at the eval's gate constant). Continuity remediation: `continuity-grader-0.4.0` keeps the 0.2.0 on-page-learning scope, explicitly treats probing questions/suspicious reactions/exact-amount references as non-disclosure unless learning is established, and uses the pinned writer tier because capture review showed Haiku remained unstable on full-length subtext; `PROMPT_VERSION 0.6.0` added the candidate-template dramatic-irony constraint. Also: wire the CLAUDE.md-mandated `DESIGN-GAP` CI grep (fail unless each occurrence references a task id).
**T6.2 Error/latency polish:** SSE reconnect, `LLM_UNAVAILABLE` toasts, optimistic-update rollback on 409.
**T6.3 Privacy pass:** delete-purge verified (T1.1), no writer text in logs (log IDs + hashes only); product copy states "not used for training" (standard API terms) and does not claim ZDR unless a ZDR agreement is executed (prompt spec §8).
*Release gate:* all evals green; e2e suite green; a human writes one complete short scene start-to-finish using only the app.

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
*Follow-up (landed with adoption):* ledger/flag ids are now globally unique `fact-<hex>` / `flag-<hex>` mints (`IdMinter`), so create-and-import no longer collides with the seed's `fact-01…08`.

**T7.8 PDF import MVP.** Add single-episode `.pdf` support to the Import wizard: contract types for `PdfExtractResult`, server-only pypdf text-layer extract with Tesseract OCR fallback, `POST /projects/import/extract-pdf`, editable Confirm source step, and existing create-and-import analyze with the confirmed text as `format: "text"`. — landed.
*Accept:* text-layer PDF extracts without LLM calls; scanned PDF uses injected/mock OCR on the PR path and system Tesseract in dev; writer can edit extracted text before **Create & analyze script**; import still creates exactly one project/root snapshot only after the analyze trigger; docs include Tesseract bootstrap (`brew install tesseract`; Debian `tesseract-ocr tesseract-ocr-eng`).

**T7.9 Import coverage heal + cost estimate.** Server fills beat-line gaps as `coverage_gap` unassigned; Review/Analyze show scene count, ~2N+1 calls, and Est. $ range from `config/llm_pricing.json`.
*Accept:* trailing/mid gaps no longer abort import; wizard shows the three estimate figures before Create & analyze. The range-heal implementation is superseded by T7.10's structurally total segment-start partition; the nominal call estimate remains `2N+1`, with a selected scene allowed one quality retry.

**T7.10 Typed segment-start import normalization.** Replace model-owned inclusive beat ranges with typed `beat | unassigned` starts; server derives ends, normalizes semantic start errors, retries severe repairs once per scene, selects the lower lexicographic repair score, and flags every repair in the selected attempt. Bump `PROMPT_VERSION`, regenerate tool schemas, and require `make evals` sign-off. — implemented; real eval sign-off passed for `PROMPT_VERSION` 0.10.0 (schema 1.00/0.98, locks 1.00/1.00, continuity 1.00/0.95 with `continuity-grader-0.4.0`).
*Accept:* gaps/overlaps are unrepresentable; duplicate/OOB/empty/missing-first/unordered starts never lose or duplicate source text; duplicate/empty/discarded-metadata/>5% repairs trigger exactly one scene retry; the better attempt wins; selected repairs have stable-code flags; lock guard runs before any segmentation call; Zod/Pydantic/data-contract/prompt summary/tool schema remain in sync.

**T7.11 Import-job checkpoint/cache spec.** Specify project-scoped reuse of validated per-scene LLM results across failed/retried atomic imports, including purge, privacy, prompt/model/source hashing, expiry, and no-writer-text logging. Separate infrastructure task; no cache implementation lands in T7.10. — queued.

**T7.12 Parallel import progress.** Run scene-level import analysis with four bounded workers while preserving the deterministic project output: results are applied in source scene order, progress SSE frames report per-scene completion monotonically, and the wizard's stage rows distinguish work-in-progress from truly completed stages.
*Accept:* segmenting/fact extraction/checking stages use at most four concurrent scene workers; final scenes/beats/facts/flags are ordered exactly as the serial source order requires; progress events for each stage are monotonic (`done` never decreases and never exceeds `total`); a stage shows Done only after every scene assigned to that stage has finished and the next stage is about to begin; import UI shows elapsed time during analysis; ETA appears only after at least 5 scene completions; stale ETA is hidden during long gaps without new completions; any worker/stage failure still emits one terminal `failed` event and creates zero project-scoped rows.

**T7.13 Import act inference + correction.** After per-scene segmentation, infer format-constrained narrative act starts from compact ordered summaries, derive a total scene partition server-side, and let writers correct a scene's act from Plan. `infer_act_breaks` is a synchronized classifier operation; its safe prompt ships at `PROMPT_VERSION` 0.11.0. — implemented; **real full-eval sign-off pending before merge**.
*Accept:* Zod/Pydantic/tool schemas and authority docs agree on `InferredActBreaks`; all freeform summary text enters prompts only through the nonce-wrapped renderer; starts must begin at scene 0 and strictly increase within format/scene bounds; omitted acts remain empty; every scene gets exactly one act; a schema-valid semantic failure gets exactly one repair and a second failure raises `SCHEMA_INVALID_LLM` with zero persisted project state; SSE stage order includes `inferring_acts`; nominal import cost is `2N+2`; Plan lists exactly the selected format's valid acts, including empty sections; optimistic correction rolls back on failure, obeys scene/episode locks, writes one snapshot, and makes zero LLM/scan calls; hard schema-validity probes include `infer_act_breaks`; the same two labeled half-hour/one-hour cases gate schema/timeout/semantic partition validity at 1.0 in default paid evals; actual transitions (excluding mandatory scene-zero anchors) score the same act within ±2 scenes at a soft ≥0.80 gate; reports/logs contain ids/counts only; non-billable suites pass and the explicitly authorized full real eval is reviewed before merge. Distinct TAG representation/inference and act-heading parsing remain deferred.

**T7.14 Import character mint + knownBy normalize.** Before ledger extraction, mint `seriesBible.characters` from Fountain character cues (heuristic, no new LLM op) and normalize extracted `knownBy` to those character ids so Ledger PEOPLE / Knowledge Web work for every imported project. Spec: `docs/superpowers/specs/2026-07-16-import-character-mint-design.md`. — implemented.
*Accept:* cue-bearing import yields non-empty `seriesBible.characters` with foundation-shaped shells (`char-{uuid}`); re-import merges speakers without wiping existing/locked characters; persisted import facts’ `knownBy` entries are project character ids (audience tokens dropped, not stored as knowers); no `PROMPT_VERSION` bump; create-and-import still one root snapshot / zero rows on failure; unit + import tests cover cue filter, merge, normalize, and end-to-end mint. DESIGN-GAP(T7.14) resolved by the continuity-layer roadmap (`docs/superpowers/specs/2026-07-16-continuity-layer-roadmap-design.md`), which phases design doc §4.8 step 2 as T7.15–T7.17 below.

**T7.15 Import entity inference (P0).** New classifier op `infer_story_entities` (characters with aliases/roles, relationships, locations/objects with source evidence) runs once per import between act inference and fact extraction; server resolves names, mints ids, merges into `seriesBible` (locked rows untouched); `knownBy` normalization becomes alias-aware. `Character.aliases` added to the contract; new `inferring_entities` SSE stage. `PROMPT_VERSION` 0.12.0 — implemented; **requires `make evals` sign-off before merge** (Task 4 fixture/gates not yet authorized/run). Plan: `docs/superpowers/plans/2026-07-16-import-continuity-mvp.md` Tasks 1–2.
*Accept:* Zod/Pydantic/data-contract/prompt-spec/tool schemas agree on `StoryEntities`; model mints no ids; schema-invalid output after one retry fails the import atomically (`SCHEMA_INVALID_LLM`, zero rows); alias-bearing mock import resolves `knownBy` names and aliases to one character id; non-speaking planted character lands in the bible; locked characters are never modified by merge; `make check-contract` green.

**T7.16 Cast management (Ledger).** Rename/aliases PATCH, atomic merge (absorbs aliases, rewrites `knownBy`, re-points relationships, one snapshot), and reference-guarded delete; PEOPLE rail management UI with optimistic rollback. Plan: same doc, Task 3.
*Accept:* each mutation writes exactly one snapshot; merge is atomic (crash leaves either both fact rewrite and character removal or neither); locked source/target ⇒ 409 `LOCKED_OBJECT`; referenced delete ⇒ 409 `VALIDATION` with counts; e2e: merge two duplicate imports and Knowledge Web focus shows the union of facts.

**T7.17 Entity-inference evals.** `fixtures/entity-inference.fountain` with planted aliases, non-speaking character, implied relationships, locations, object; soft gates: entity recall ≥ 0.8, alias resolution ≥ 0.9, zero basis-free entities. Plan: same doc, Task 4. — implemented; `make evals-dry --full` green (both soft families WARN on the seeded Mock, as expected, and never block); **real `make evals` sign-off (0.12.0) still pending explicit authorization**, which also covers T7.15's pending sign-off above.
*Accept:* eval family wired into `make evals` (`entity-inference` + `alias-resolution`, both soft, in `SOFT_EVAL_KEYS`); non-billable dry-run green; test-plan §1/§3 rows added; real-eval run only on explicit authorization.

**T7.18 Time-aware ledger (as-of scene).** Filter ledger facts to those in force as of a chosen scene using existing `sourceSpan` + supersede semantics — first P1 cut of the continuity-layer roadmap. Spec/plan: `docs/superpowers/specs/2026-07-16-time-aware-ledger-design.md`, `docs/superpowers/plans/2026-07-16-time-aware-ledger.md`. No new LLM op / no `PROMPT_VERSION` bump. — implemented.
*Accept:* `facts_as_of` unit-tested (later-established out; superseded-after still in; superseded-before out); `GET /ledger?asOfScene=` filters accordingly (unknown scene → 400 `VALIDATION`); Ledger UI As-of control refetches with the param; data-contract + test-plan updated.

**T7.19 Narrative promises contract (P2).** `StoryThread` on `Episode`, structured `WorldRule` fields, §2a `NarrativePromises`, import stage `inferring_promises`. Spec/plan: `docs/superpowers/specs/2026-07-16-narrative-promises-design.md`, `docs/superpowers/plans/2026-07-16-narrative-promises.md`. — in progress.
*Accept:* Zod/Pydantic/data-contract/prompt-spec/tool schemas agree; fixture validates with `threads: []` and worldRule defaults; `make check-contract` green.

**T7.20 Import narrative-promises inference.** Classifier op after entity inference; merge threads/motivations/world rules; `PROMPT_VERSION` 0.13.0 — **requires `make evals` sign-off before remote merge**. Plan Tasks 2.
*Accept:* mock import yields threads with resolved owners + setup scenes; motivations land on scenes; locked world rules untouched; atomic fail on schema-invalid after one retry.

**T7.21 Ledger Threads panel.** List open/paid_off/abandoned with setup/payoff scene jump. Plan Task 3.
*Accept:* Vitest covers render + navigation affordance; tokens only.

**T7.22 Narrative-promises evals.** Planted fixture + soft recall gates; dry-run only until authorized. Plan Task 4.

## Milestone 8 — Fabula adoption (P-MVP slices)

See `docs/tableread-adoption-prd.md` for full A1–A10 requirements. Sequencing table there maps items onto earlier milestones; remaining P-MVP work lands here as explicit tasks.

**T8.1 JSON export (A6-MVP).** `GET /projects/{pid}/export.json` returns the `PersistedState` envelope; Settings → **Export project JSON**; round-trip purge/re-seed restores project doc + ledger byte-identical. — landed.

**T8.2 Undo timeline dropdown (A5).** `GET /projects/{pid}/snapshots` + `POST /projects/{pid}/restore`; Undo ▾ lists ~20 ancestors (instruction + relative time); restore is ancestor-of-head only; empty instruction rejected. — landed.

**T8.3 Suggestion carousels (A4) + Write keyboard (A8).** `POST /suggest` + chips on command bar / Tune / scene what-happens; Write shortcuts Q/W/Tab/Enter/Esc/1–3 (disabled while canvas focused). Prompt `build_suggest_prompt` bumps `PROMPT_VERSION` to 0.8.0 — **needs `make evals` sign-off**. — landed (evals pending).

**T8.4 Lock-repair prompt + import/subtext evals (A1, A2, A10).** Shared-system HARD RULES for lock-aware narrative repair + subtext fidelity (`PROMPT_VERSION` 0.9.0); `fixtures/import-inference.fountain` + planted JSON; soft evals `lock-repair` / `import-inference` / `subtext` wired into `make evals`. — landed (**needs `make evals` sign-off**).

**T8.5 Craft-level picker (A3 / P-v2).** `Project.defaultCraftLevel`; `craftLevel` on candidate SSE + Change Set preview; Fast (1) / Standard (3) / Considered (drafts + polish, no new LLM ops); Write dock + Review preview + Settings picker. — landed.

**T8.6 Workflow-recipe onboarding (A9 / P-v2).** `recipes.json` + `?tour=` overlay highlighting real controls; dashboard recipe picker + first-run; e2e walks each recipe on the seeded fixture. — landed.

## Sequencing & parallelism

```
M0 (all parallel) → M1 → M2 & M3 in parallel → M4 → M5 → M6
```

Agents must not start M4 before M2.2 lands (Change Sets reuse the regeneration + ledger plumbing). UI tasks (T2.3, T3.1, T4.3, T5.1) can be built against the mock API as soon as T1.2 exists.
