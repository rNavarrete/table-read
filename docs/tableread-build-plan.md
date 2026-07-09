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
*Accept:* fixture exports to valid Fountain (round-trips through `fountain-js` parse); importing that export reproduces scene/beat count and returns `{project, newFacts, consistencyFlags}` with every imported fact `pending_review`; overlapping/gapped beat line-ranges reject with `VALIDATION` and persist nothing; unassigned ranges preserved in scriptText and flagged — reconstructed text byte-identical to source; a mid-transaction failure (fault injection) leaves zero rows changed.

## Milestone 2 — Write mode

**T2.1 Candidate generation endpoint.** SSE per data contract; sequential diversity calls; context bundle per prompt spec §1 (ledger filtering, locked beats, token budget).
*Accept:* streams 3 `candidate_done` events with schema-valid `BeatCandidate`s against mock; a mock invalid candidate emits `candidate_failed`, not a partial card; context bundle snapshot-tested (locked beat text present, facts filtered by `isPromptEligibleFact` — prompt spec §8, all freeform fields wrapped in `<source_data kind="...">` tags, ≤6k tokens on fixture); cards actionable only after `candidate_done`.

**T2.2 Accept/Tune/Skip + ledger hook.** Accept inserts beat + snapshot + fires `extract_ledger_facts` and `scan_consistency`; tune endpoint; skip is client-side.
*Accept:* accepting fixture candidate adds beat with correct `index`; new facts land `pending_review` when confidence <0.8, else `active`; contradiction creates supersede proposal without overwriting (fact-07 case from prompt spec); mock scan flags surface in the accept response.

**T2.3 Write mode UI.** Script canvas (teleplay CSS), right candidate cards with labels + Accept/Tune/Skip, bottom command bar, streaming text. States per UI spec §3: empty, streaming, error.
*Accept:* e2e (Playwright + mock API): open fixture scene-3 → "Next Beat" → 3 labeled cards stream in → Accept → beat appears in script → ledger badge increments. AI controls invisible while textarea focused (spec §3).

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

## Milestone 6 — Hardening & release gate

**T6.1 LLM evals wired to CI** (test plan §3): schema-validity, lock-violation (must be 0), continuity checks on fixture. Run nightly + on prompt changes. Also: segmentation-determinism eval for `segment_scene` — tracks DESIGN-GAP(T6.1) in `apps/api/llm/ops.py` (prompt spec §7 mandates temperature 0, current writer-tier models reject sampling params; if determinism regresses, move the op to the classifier tier). Also: wire the CLAUDE.md-mandated `DESIGN-GAP` CI grep (fail unless each occurrence references a task id).
**T6.2 Error/latency polish:** SSE reconnect, `LLM_UNAVAILABLE` toasts, optimistic-update rollback on 409.
**T6.3 Privacy pass:** delete-purge verified (T1.1), no writer text in logs (log IDs + hashes only); product copy states "not used for training" (standard API terms) and does not claim ZDR unless a ZDR agreement is executed (prompt spec §8).
*Release gate:* all evals green; e2e suite green; a human writes one complete short scene start-to-finish using only the app.

### Remediation tracking (M4/M5 wave — API)

- Null-replacement retirement confirm (ruling 1): stored-null empty `fact`; confirm supersedes target + rejects proposal — landed in remediation/api.
- Locked-scene beat reorder blocked (ruling 2) — landed in remediation/api.
- Change Set GET endpoints (ruling 3) — landed in remediation/api; UI may drop DESIGN-GAP(T4.3) sessionStorage comments once wired.
- DESIGN-GAP(T5.1) edit→active: closed via data-contract §4 note (this remediation).

## Sequencing & parallelism

```
M0 (all parallel) → M1 → M2 & M3 in parallel → M4 → M5 → M6
```

Agents must not start M4 before M2.2 lands (Change Sets reuse the regeneration + ledger plumbing). UI tasks (T2.3, T3.1, T4.3, T5.1) can be built against the mock API as soon as T1.2 exists.
