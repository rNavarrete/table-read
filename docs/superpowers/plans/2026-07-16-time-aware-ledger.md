# Time-Aware Ledger (P1 slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Filter the ledger to facts in force as of a chosen scene, using existing `sourceSpan` + supersede data — first cut of roadmap P1.

**Architecture:** Pure helper `facts_as_of(scenes, ledger, as_of_scene_id)` in `drama_manager/`; wire optional `asOfScene` on `GET /ledger`; Ledger UI adds an As-of scene control that passes the query param.

**Tech Stack:** Python 3.12 FastAPI, React Ledger, pytest/Vitest. No new LLM op.

## Global Constraints

- No `PROMPT_VERSION` bump; no new LLM ops
- Every mutation still via snapshots (this slice is read-only on the API path)
- No writer text in logs
- Tokens only in UI (`--tr-*`)
- Schema/docs: document query param in data-contract; no LedgerFact field changes unless unavoidable

---

### Task 1: Pure `facts_as_of` + unit tests

**Files:**
- Create: `apps/api/drama_manager/ledger_as_of.py`
- Create: `apps/api/tests/test_ledger_as_of.py`

**Interfaces:**
- Produces: `def facts_as_of(scenes: list[dict], ledger: list[dict], as_of_scene_id: str) -> list[dict]`
  - `scenes` = ordered episode scene docs (`id` field)
  - Raises `KeyError` if `as_of_scene_id` not in scenes
  - Returns facts in force per `docs/superpowers/specs/2026-07-16-time-aware-ledger-design.md`

- [ ] **Step 1: Write failing tests** for: later-established excluded; superseded-after still included; superseded-before excluded; orphan source scene excluded; unknown asOf raises

- [ ] **Step 2: Run** `/Users/rolandonavarrete/Documents/tableread/apps/api/.venv/bin/python -m pytest apps/api/tests/test_ledger_as_of.py -q` — expect FAIL

- [ ] **Step 3: Implement** `facts_as_of` in `ledger_as_of.py`

- [ ] **Step 4: Run tests** — expect PASS

- [ ] **Step 5: Commit** `ledger: facts_as_of helper for scene-temporal filter (T7.18)`

---

### Task 2: Wire `GET /ledger?asOfScene=`

**Files:**
- Modify: `apps/api/routes.py` (`get_ledger`)
- Modify: `apps/web/src/api/client.ts` (ledger fetch query)
- Modify: `docs/tableread-data-contract.md` (§4 ledger GET)
- Test: `apps/api/tests/test_ledger.py` or new cases in existing ledger route tests

**Interfaces:**
- Consumes: `facts_as_of`
- Query param `asOfScene: str | None = None`
- Resolve episode scenes from project doc (first episode / same path other ledger code uses)
- Unknown scene → 400 `{error: {code: "VALIDATION", message: ...}}` matching project style

- [ ] Failing API test with seeded project: `asOfScene=scene-1` excludes facts established in later scenes
- [ ] Implement route + client query wiring
- [ ] Update data-contract
- [ ] Commit: `api: ledger asOfScene query filter (T7.18)`

---

### Task 3: Ledger UI As-of control

**Files:**
- Modify: `apps/web/src/ledger/FilterRail.tsx` and/or `LedgerScreen.tsx`
- Test: `apps/web/src/ledger/LedgerScreen.test.tsx` (or focused new test)

**Behavior:**
- Scene `<select>` or list labeled **As of** under Lenses/Status; first option **Latest (all)**
- Changing selection refetches ledger with `asOfScene`
- Empty-after-filter copy stays clear

- [ ] Failing Vitest: selecting a scene calls client with `asOfScene`
- [ ] Implement control + wiring
- [ ] Commit: `ledger: As-of scene filter in Ledger UI (T7.18)`

---

### Task 4: Docs — build plan + test plan

**Files:**
- Modify: `docs/tableread-build-plan.md` (T7.18 acceptance)
- Modify: `docs/tableread-test-plan.md` (§1 bullets)

- [ ] Add T7.18 landed note + accept criteria
- [ ] Commit: `docs: time-aware ledger as-of filter (T7.18)`

## Self-review

- Spec coverage: semantics, API, UI, tests — Tasks 1–4
- Deferred: knowledge transitions, relative time, relationship history, object custody (later P1 slices)
