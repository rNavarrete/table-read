# Time-Aware P1 Remainder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish continuity roadmap P1 so the ledger answers “what was true, and who knew it, as of scene N,” plus timeline anchors, relationship states, and object custody.

**Architecture:** Extend `LedgerFact` with `knowledgeEvents`; pure `knowers_as_of` + wire into `GET /ledger?asOfScene=` as `knownByAsOf`; extract optional events on import; then episode-level timeline/relationship/object state arrays with import merge and light UI.

**Tech Stack:** Zod/Pydantic, FastAPI, React Ledger, pytest/Vitest.

**Spec:** `docs/superpowers/specs/2026-07-16-time-aware-p1-remainder-design.md`

## Global Constraints

- Schema changes touch every home or none; `make check-contract` green
- Prompt changes bump `PROMPT_VERSION` and **must not run `make evals` without authorization**
- Snapshots for mutations; import atomic
- No writer text in logs; tokens only in UI
- P2 narrative-promises branch stays parked

---

### Task 1: Contract — `knowledgeEvents` + `knownByAsOf` response field

**Files:** `packages/contract/src/index.ts`, `apps/api/schemas.py`, data-contract, fixture defaults, export-json-schema if ExtractedFact gains events

```ts
export const KnowledgeEvent = z.object({
  sceneId: Id,
  characterIds: z.array(Id).default([]),
  kind: z.enum(["learns", "forgets"]),
  quote: z.string().default(""),
});
// LedgerFact.knowledgeEvents: z.array(KnowledgeEvent).default([])
// ExtractedFact optional knowledgeEvents with characterNames: string[] instead of ids — server resolves
// Ledger GET items may include knownByAsOf?: Id[] when asOfScene set (document in §4; can be response-only enrichment not stored)
```

- [ ] Schemas + defaults so fixture validates
- [ ] `make check-contract` green
- [ ] Commit: `contract: LedgerFact.knowledgeEvents (T7.23)`

---

### Task 2: `knowers_as_of` + API enrichment

**Files:** `apps/api/drama_manager/ledger_as_of.py`, `routes.py` get_ledger, tests

- [ ] `knowers_as_of(fact, scenes, as_of_scene_id) -> list[str]`
- [ ] When `asOfScene` set, each returned fact includes `knownByAsOf`
- [ ] Commit: `ledger: knownByAsOf for as-of-scene queries (T7.23)`

---

### Task 3: Import extract + normalize knowledge events

**Files:** render extract prompt (bump PROMPT_VERSION 0.12→0.13), pipeline `_to_ledger_fact` / normalize, mock defaults, tests

- [ ] Optional events on extract; resolve names→ids; drop audience
- [ ] Commit: `import: extract knowledge events onto ledger facts (T7.23)`

---

### Task 4: Ledger UI uses `knownByAsOf` when as-of set

**Files:** KnowledgeWeb / fact detail / LedgerScreen

- [ ] Web focus + detail prefer `knownByAsOf` ?? `knownBy`
- [ ] Commit: `ledger: Knowledge Web respects knownByAsOf (T7.23)`

---

### Task 5: Timeline anchors (T7.24)

Episode `timelineAnchors[]`; infer in import (extend entities or small merge from scene time text + optional LLM fields); list in Ledger or Plan later — MVP: store + GET via project doc only, unit tests on merge.

- [ ] Contract + merge + tests
- [ ] Commit: `import: episode timelineAnchors (T7.24)`

---

### Task 6: Relationship states (T7.25)

Episode `relationshipStates[]`; import merge; as-of helper for latest state ≤ scene

- [ ] Commit: `import: relationship state history (T7.25)`

---

### Task 7: Object custody (T7.26)

Episode `objectStates[]` + deterministic conflict → open flags after import

- [ ] Commit: `import: object custody states and conflict flags (T7.26)`

---

### Task 8: Docs + merge to main

Build plan T7.23–T7.26, test plan, roadmap P1 exit note; FF-merge branch to local main.

- [ ] Commit docs; merge `--ff-only` to main
