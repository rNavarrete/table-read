# Time-Aware Story State — P1 Remainder Design

**Date:** 2026-07-16  
**Status:** Active (finish before P2)  
**Parent:** continuity-layer roadmap §P1  
**Already shipped:** T7.18 as-of-scene filter (“what was true as of N”)  
**P2 note:** Narrative-promises design/plan docs exist on branch `narrative-promises-p2` but are **parked** until this remainder lands.

## Exit criterion (roadmap)

> The ledger can answer: **what was true, and who knew it, as of scene N.**

T7.18 covers “what was true.” Remaining work covers “who knew it,” plus the other P1 bullets.

## Remaining work (order)

### T7.23 — Knowledge transitions (priority; unblocks exit)

**Problem:** `knownBy` is a flat list on each fact. As-of-scene cannot show who knew a fact _at scene k_ vs later.

**Model:** Add optional `knowledgeEvents` on `LedgerFact`:

```ts
knowledgeEvents: [{
  sceneId: Id,           // when the knowledge change happens
  characterIds: Id[],    // who newly knows (gain) — empty = N/A
  kind: "learns" | "forgets"  // MVP: mostly "learns"
  quote: string          // ≤200 chars evidence
}].default([])
```

**Semantics for as-of:**

- At establishment scene, `knownBy` is the baseline knower set.
- For scene k ≥ establish: start from baseline `knownBy`, then apply all `knowledgeEvents` with `sceneId` index ≤ k (`learns` ∪, `forgets` ∖).
- Helper: `knowers_as_of(fact, scenes, asOfSceneId) -> Id[]`.
- Extend `GET /ledger?asOfScene=` response: either rewrite `knownBy` in the returned payload for display, or add `knownByAsOf` — prefer **`knownByAsOf`** so baseline `knownBy` stays canonical for edits. UI Knowledge Web uses `knownByAsOf` when as-of is set.

**Import:** Extend fact extraction _or_ a small post-pass in `infer_narrative_promises` deferred — **prefer extending `ExtractedFact`** with optional `knowledgeEvents` (names → ids server-side) so extract stays one call. If that busts extract quality, add classifier op `infer_knowledge_events` later. First cut: optional field on `ExtractedFact` + prompt note; empty array OK.

**PROMPT_VERSION:** bump only if extract prompt changes (likely 0.12.0 → 0.13.0). Track eval debt; no unauthorized `make evals`.

### T7.24 — Timeline anchors

Extract relative time markers (“three days later”, “that night”) as episode-level `timelineAnchors: [{ afterSceneId, label, kind: "relative"|"absolute", quote }]`.  
Used for display + future compiler; as-of filter remains scene-index-based in MVP (anchors do not reorder scenes).

### T7.25 — Relationship state history

Scene-anchored rows: `{ between: [Id, Id], label, sceneId, quote }` on the episode (or ledger `factType: relationship` already — prefer **episode `relationshipStates[]`** so bible `relationships` stay the “baseline” and states are timeline).  
Ledger/Web can show state as-of scene via last state with `sceneId` ≤ k.

### T7.26 — Object custody / location continuity

Lightweight checks (not full compiler): for facts typed `state`/`event` that mention object custody language, flag when an object’s last known holder/location contradicts a later fact — **or** simpler MVP: track `objectStates: [{ name, holderCharacterId|null, locationLabel, sceneId, quote }]` and surface conflicts as open ConsistencyFlags after import scan. Prefer object state table + one deterministic conflict pass (no new LLM if possible); LLM extract of object states if needed.

## Non-goals (still P2/P3)

- Threads / setups-payoffs
- Structured world-rule schema beyond today’s text
- Full Compile Story UI

## Acceptance (P1 complete)

1. With as-of scene set, Knowledge Web / fact detail shows knowers at that scene (`knownByAsOf`), not only baseline.
2. At least one import path can populate `knowledgeEvents` (mock + fixture).
3. Timeline anchors, relationship states, and object states extract or merge on import with tests.
4. `make check-contract` green; prompt bump only when prompts change; real evals on authorization.
