# New Project Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded seeded-project entry with a Story Launcher dashboard, idea/import wizards, and project-scoped resume — every AI step explicit and reviewable.

**Architecture:** Add `ProjectSummary` + list/create/import-create APIs (Zod↔Pydantic↔docs). Web root becomes `/projects` (Story Launcher). Mode screens require `?project=` and redirect home when missing. Idea creation is atomic root snapshot with optional foundation (no LLM). Import create-and-import is one root snapshot + SSE progress. Scene skeleton is a three-candidate Change Set path (prompt-changing; Task 6).

**Tech Stack:** FastAPI + SQLAlchemy/SQLite (`apps/api`), React 18 + TS + Vite + Tailwind (`apps/web`), Zod contract (`packages/contract`), Vitest + Playwright + pytest. Spec: `docs/superpowers/specs/2026-07-10-new-project-flow-design.md`.

## Global Constraints

- Trust promise (verbatim): *Every AI step is explicit, reviewable, and begins only after you confirm the source material.*
- No AI on upload/paste/blur/navigation/project create — only on explicit **Create & analyze script** / **Generate scene skeleton**.
- Clients never mint IDs; server assigns.
- Every mutation snapshots; create-and-import = **exactly one** root snapshot with imported doc/ledger/flags.
- Import-derived facts always `pending_review`.
- Locks sacred; lock-violation test before feature test for any new generation path.
- No writer text in logs (IDs, hashes, token counts, PROMPT_VERSION only).
- Schema changes: Zod + Pydantic + data-contract (+ prompt-spec + tool_schemas for LLM ops). `make check-contract` green.
- MockLlmClient in tests; never real Anthropic. Task 6 needs explicit `make evals` approval before merge.
- Tokens only in UI (`--tr-*`); Quiet Tool language.
- Each task: TDD, focused tests, `make lint` (or scoped lint), commit.

---

## File map

| Area | Primary files |
|---|---|
| Contract | `packages/contract/src/index.ts`, export scripts, `apps/api/schemas.py`, `docs/tableread-data-contract.md` |
| API list/create | `apps/api/routes.py`, `apps/api/storage/models.py`, `apps/api/storage/snapshots.py`, `apps/api/tests/test_projects.py` |
| Import create | `apps/api/fountain/pipeline.py`, new create-import helper, `apps/api/tests/test_import.py` |
| Scene skeleton | `apps/api/drama_manager/`, `apps/api/llm/`, `config/tool_schemas/`, prompt templates, Change Set apply |
| Web dashboard | `apps/web/src/projects/` (new), `App.tsx`, `api/client.ts` |
| Routing/resume | `WriteScreen`, `PlanScreen`, `ReviewScreen`, `LedgerScreen`, `AppShell`, `modeNavigation` |
| Wizard | `apps/web/src/projects/wizard/` |
| Docs | `tableread-ui-spec.md`, `narrative-sidekick-design-doc.md`, `tableread-test-plan.md`, `tableread-build-plan.md`, prompt-spec (Task 6) |

---

### Task 1: Contract + `GET /projects` + dashboard shell

**Files:**
- Modify: `packages/contract/src/index.ts` — add `ProjectSummary`
- Modify: `apps/api/schemas.py` — Pydantic mirror
- Modify: `docs/tableread-data-contract.md` — `GET /projects`, `ProjectSummary`
- Modify: `apps/api/routes.py` — `GET ""` list before `/{pid}`
- Modify: `apps/api/storage/models.py` — ensure `updated_at` available (already exists)
- Create: `apps/web/src/projects/DashboardScreen.tsx`, `ProjectRow.tsx`, `dashboardStatus.ts`
- Modify: `apps/web/src/App.tsx` — `/projects` → Dashboard; `/` → redirect `/projects`
- Modify: `apps/web/src/api/client.ts` — `listProjects()`
- Test: `apps/api/tests/test_projects.py`, `apps/web/src/projects/DashboardScreen.test.tsx`
- Modify: `docs/tableread-ui-spec.md` — dashboard section

**Interfaces:**
- Produces: `ProjectSummary { id, title, format, updatedAt, pendingReviewCount, setupState: "incomplete"|"ready" }`
- `GET /api/v1/projects` → `ProjectSummary[]` sorted by `updatedAt` desc
- `setupState === "ready"` iff ≥1 scene with ≥1 beat
- `listProjects(): Promise<ProjectSummary[]>`

- [ ] **Step 1: Add Zod `ProjectSummary` and failing contract/API tests**

```ts
export const ProjectSummary = z.object({
  id: Id,
  title: z.string(),
  format: ShowFormat,
  updatedAt: z.string().datetime(),
  pendingReviewCount: z.number().int().min(0),
  setupState: z.enum(['incomplete', 'ready']),
})
```

API test: seeded fixture appears in list with `setupState: "ready"`, `pendingReviewCount` matching pending facts, `updatedAt` ISO; empty DB → `[]`; response must not include `premise`/`seasons`.

- [ ] **Step 2: Run tests — expect FAIL (no schema / no route)**

Run: `cd apps/api && .venv/bin/pytest tests/test_projects.py -k list -v` and contract check for new type once mirrored.

- [ ] **Step 3: Implement Pydantic + `GET /projects` + summary builder**

Register route **before** `/{pid}`. Build summaries from `ProjectRow.doc` + ledger pending count + `updated_at` as RFC3339 UTC (`…Z`).

- [ ] **Step 4: Web `listProjects` + Dashboard shell (Story Launcher)**

States: loading skeleton, empty (both creation cards), populated (≤5 recent), search-empty, error+Retry. Accent `+ New project` pill. Cards can be stubs linking to `#` until Task 3–5. Status helper:

```ts
export function rowStatus(s: ProjectSummary): 'facts' | 'setup' | 'ready' {
  if (s.pendingReviewCount > 0) return 'facts'
  if (s.setupState === 'incomplete') return 'setup'
  return 'ready'
}
```

- [ ] **Step 5: `make check-contract` + focused tests + lint; commit**

```bash
git add packages/contract apps/api apps/web/src/projects apps/web/src/App.tsx apps/web/src/api/client.ts docs/tableread-data-contract.md docs/tableread-ui-spec.md
git commit -m "$(cat <<'EOF'
projects: list summaries and Story Launcher dashboard

EOF
)"
```

---

### Task 2: Routing cleanup + resume context

**Files:**
- Modify: `WriteScreen.tsx`, `PlanScreen.tsx`, `ReviewScreen.tsx`, `LedgerScreen.tsx` — remove `DEFAULT_PROJECT_ID`
- Create: `apps/web/src/projects/resumeContext.ts` (+ test)
- Modify: `AppShell.tsx` — wordmark → `/projects`; require `projectId`
- Modify: e2e helpers / specs that assume bare `/` loads fixture — use `/?project=proj-longpour` or `/projects` then open
- Test: unit tests for redirect + resume fallback

**Interfaces:**
- Consumes: `ProjectSummary` / project id from URL
- Produces: `loadResume(projectId)`, `saveResume(projectId, { mode, sceneId })` in `localStorage` key `tr.resume.v1.<projectId>`
- Missing `?project=` on mode routes → `location.assign('/projects')`

- [ ] **Step 1: Failing tests — no project param redirects; resume falls back on stale scene**

- [ ] **Step 2: Implement redirect + resume helpers; wire mode screens to save on navigation**

- [ ] **Step 3: Update Playwright specs that hit `/` or `/?scene=` without project**

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
web: require project id; local resume context

EOF
)"
```

---

### Task 3: Shared wizard shell + format presets + local drafts

**Files:**
- Create: `apps/web/src/projects/wizard/WizardShell.tsx`, `FormatPresets.tsx`, `wizardDraft.ts`, tests
- Modify: `DashboardScreen` — `+ New project` opens path chooser; cards deep-link `/projects/new/idea` and `/projects/new/import`
- Modify: `App.tsx` — routes for wizard paths (placeholder step content OK)

**Interfaces:**
- Produces: `FORMAT_PRESETS` mapping to `ShowFormat`; `saveDraft(path, data)`, `loadDraft(path)`, `clearDraft(path)` under `tr.wizard.v1.*`
- WizardShell: steps, Back/Continue/Cancel, trust note slot, focus-first-invalid

Presets (exact):

```ts
export const FORMAT_PRESETS = {
  'one-hour-drama': {
    genre: 'drama',
    runtimeMinutes: 60,
    actCount: 5,
    coldOpen: true,
    tag: true,
    serialization: 0.7,
  },
  'half-hour-comedy': {
    genre: 'comedy',
    runtimeMinutes: 30,
    actCount: 2,
    coldOpen: true,
    tag: false,
    serialization: 0.3,
  },
  'actless-streaming': {
    genre: 'dramedy',
    runtimeMinutes: 60,
    actCount: 1,
    coldOpen: false,
    tag: false,
    serialization: 0.8,
  },
} as const
```

Trust note copy (verbatim): *Every AI step is explicit, reviewable, and begins only after you confirm the source material.*

- [ ] **Step 1: Failing tests for draft round-trip and preset shapes**

- [ ] **Step 2: Implement shell + presets + draft storage**

- [ ] **Step 3: Wire dashboard navigation; commit**

```bash
git commit -m "$(cat <<'EOF'
web: new-project wizard shell and format presets

EOF
)"
```

---

### Task 4: Idea path + foundation-aware create

**Files:**
- Modify: `packages/contract/src/index.ts` — `CharacterSeed`, `ProjectFoundationInput`, `ProjectCreateRequest`
- Modify: `apps/api/schemas.py`, data-contract
- Modify: `apps/api/routes.py` — accept body model; optional foundation; `Idempotency-Key` header
- Modify: `apps/api/storage/models.py` — `creation_idempotency_key` unique nullable + `creation_request_hash` (or equivalent storage-only columns)
- Create: `apps/web/src/projects/wizard/IdeaWizard.tsx` (+ tests)
- Modify: `client.ts` — `createProject(body, { idempotencyKey })`

**Interfaces:**
- `CharacterSeed { name: string, traits?: string }`
- `ProjectFoundationInput { existentialQuestion?: string, storiesToAvoid?: string[], characters?: CharacterSeed[] }`
- `ProjectCreateRequest { title, format, premise, foundation? }`
- Server maps seed → Character with empty `embodiment`/`presentation`/`hiding`/`seriesArc`, `traits` from seed or `""`, server id `char-…`
- Idempotency: same key+hash → replay 201 body; same key different hash → 409 `IDEMPOTENCY_CONFLICT`; failed txn leaves no key

- [ ] **Step 1: Failing API tests — foundation characters get server IDs; no LLM; idempotency replay/conflict**

- [ ] **Step 2: Implement create with foundation + idempotency columns**

- [ ] **Step 3: IdeaWizard steps 1–4; Create project button; clear draft; navigate to `/plan?project=` (guided setup stub OK until Task 6)**

- [ ] **Step 4: `make check-contract` + tests + commit**

```bash
git commit -m "$(cat <<'EOF'
projects: foundation-aware create with idempotency

EOF
)"
```

---

### Task 5: Import path + atomic create-and-import + SSE progress

**Files:**
- Contract: `ProjectImportCreateRequest`, `ProjectImportProgressEvent`, `ProjectImportResult`
- Modify: `fountain/pipeline.py` — extract assemble/import-into-doc helpers usable before any project row exists
- Create: `apps/api/fountain/create_import.py` (or similar) — one transaction: create project row + root snapshot with imported state
- Modify: `routes.py` — `POST /projects/import` (or `/projects:import`) SSE
- Create: `apps/web/src/projects/wizard/ImportWizard.tsx`
- Tests: fault injection at each stage → zero rows; success → one root snapshot; idempotency

**Interfaces:**
- Request: title, format, premise?, `{ format: "fountain"|"text", content }` + Idempotency-Key
- SSE events: `stage { name: "parsing_scenes"|"segmenting_beats"|"extracting_facts"|"checking_consistency"|"saving" }`, `complete { result }`, `failed { error }`
- Result: `{ project, newFacts, consistencyFlags }` (same shape as existing import)
- Exactly one root snapshot (`parentId: null`) with imported doc/ledger/flags

- [ ] **Step 1: Lock/coverage/fault-injection tests first (fail)**

- [ ] **Step 2: Refactor pipeline so analysis can run without mutating; then single create+snapshot write**

- [ ] **Step 3: SSE route + client EventSource/fetch stream**

- [ ] **Step 4: ImportWizard — upload+paste, review source, Create & analyze, progress UI, Plan handoff**

- [ ] **Step 5: Docs (data-contract + UI import exception note) + commit**

```bash
git commit -m "$(cat <<'EOF'
projects: atomic create-and-import with SSE progress

EOF
)"
```

---

### Task 6: Guided Plan setup + scene-skeleton Change Set (prompt-changing)

**Files:**
- Contract: `InitialSceneSkeleton`, Change Set preview variant `initial_scene_skeleton`, proposalId handles
- Prompt: new/updated template, bump `PROMPT_VERSION`, regenerate `config/tool_schemas/`
- API: generate 3 candidates; select → draft Change Set; apply via existing preview/apply with proposal IDs
- Web: guided setup surface on Plan for `setupState incomplete`; candidate picker → Review
- **Lock-violation test BEFORE feature tests**

**Interfaces:**
- Three candidates; each scene addition has server `proposalId` (not final scene id)
- Apply maps `approvedObjectIds` (proposal IDs) → new scene/beat IDs; stale `basedOnSnapshotId` → 409
- No `scriptText` in skeleton

- [ ] **Step 1: Write lock-violation test for skeleton apply — FAIL then keep red until apply respects locks**

- [ ] **Step 2: Schema + prompt + MockLlmClient fixtures for 3 skeletons**

- [ ] **Step 3: Generate / select / Change Set create / apply path**

- [ ] **Step 4: Guided Plan UI**

- [ ] **Step 5: `make check-contract`; unit tests; DO NOT run `make evals` unless user explicitly asks**

- [ ] **Step 6: Commit**

```bash
git commit -m "$(cat <<'EOF'
plan: initial scene-skeleton Change Set (3 candidates)

EOF
)"
```

---

### Task 7: E2E, docs authority sync, verification

**Files:**
- `apps/web/e2e/` — dashboard, idea, import, resume, delete
- Docs: `narrative-sidekick-design-doc.md` (dashboard + import exception), `tableread-test-plan.md`, `tableread-build-plan.md`, UI spec polish
- Delete confirmation UI if not done earlier (typed title → `DELETE /projects/{pid}`)

- [ ] **Step 1: E2E for the five acceptance flows in the spec §12**

- [ ] **Step 2: `make test && make lint && make check-contract && make e2e`**

- [ ] **Step 3: Doc sync commit**

```bash
git commit -m "$(cat <<'EOF'
docs: new-project flow authority sync

EOF
)"
```

---

## Spec coverage checklist

| Spec § | Task(s) |
|---|---|
| Dashboard / Story Launcher | 1, 2 |
| Resume / no seeded fallback | 2 |
| Wizard shell / presets / drafts | 3 |
| Idea path / foundation create | 4 |
| Import upload+paste / atomic create-import / SSE | 5 |
| AI trust note / explicit triggers | 3–6 |
| Guided setup + 3-candidate skeleton Change Set | 6 |
| Idempotency | 4, 5 |
| E2E + authority docs | 7 |
| Non-goals (PDF, multi-ep, etc.) | out of plan |

## Placeholder scan

No TBD/TODO steps. Task 6 evals gated on explicit user approval.
