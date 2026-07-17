# Narrative Promises (P2) — Design

**Date:** 2026-07-16  
**Status:** Approved goal (implement, then break)  
**Parent:** `docs/superpowers/specs/2026-07-16-continuity-layer-roadmap-design.md` §P2  
**Build-plan:** T7.19–T7.22

## Goal

On every import, extract **narrative promises** the writer can audit:

1. **Threads** — setups → escalations → reveals → payoffs / abandoned  
2. **Scene motivations** — fill existing `Scene.motivations` from the script  
3. **Structured world rules** — rule + limit + cost + exception + evidence  

This is the substrate for later “unresolved setup / weak payoff” compiler checks (P3). Connector lines in Plan (design doc §4.4) remain a UI follow-up; this slice lands the data + a Ledger list.

## P1 dependency (explicit)

Full P1 (knowledge transitions, relative time) is unfinished. Threads use **scene order + `sourceSpan`** (and T7.18 as-of) as the temporal spine. That is enough for establish/payoff scene anchors; we do **not** block P2 on remaining P1 work.

## Non-goals

- Plan canvas setup↔payoff connector lines (UI; data ready for a later task)  
- Full story compiler / health dashboard (P3)  
- Cross-episode threads  
- Auto-closing threads without writer review  

## Data model

### `StoryThread` (new; lives on `Episode` as `threads: StoryThread[]`)

```ts
status: "open" | "paid_off" | "abandoned"
// lifecycle detail is in events, not a single status enum of steps —
// an open thread may have only a setup; paid_off has a payoff span.
```

Wire shape:

| Field | Meaning |
|---|---|
| `id` | Server-minted `thread-{hex}` |
| `label` | Short name (“Sports Almanac temptation”) |
| `summary` | One–two sentences |
| `status` | `open` \| `paid_off` \| `abandoned` |
| `ownerCharacterIds` | Characters who own/drive the thread (resolved ids) |
| `setupSceneId` | Scene where the promise is planted |
| `payoffSceneId` | Scene where paid off (null if open/abandoned) |
| `setupQuote` | Short evidence (≤200 chars) |
| `payoffQuote` | Short evidence or `""` |
| `locked` | default false |

MVP stores threads on the **first (only) episode**. Re-import replaces imported threads the same way scenes are replaced (writer-authored locked threads preserved if we add lock later — v1: all import threads unlocked; re-import drops prior import-minted threads for that episode and remints).

### `WorldRule` (extend existing bible entry)

Today: `{ text, locked }`. Add optional structured fields with defaults:

| Field | Default |
|---|---|
| `limit` | `""` |
| `cost` | `""` |
| `exception` | `""` |
| `evidenceSceneId` | `null` |
| `evidenceQuote` | `""` |

Existing fixture rules remain valid (defaults).

### Motivations

No schema change — `Motivation { characterId, objective, stakes, obstacle }` already on `Scene`. Import fills them when character ids resolve.

## LLM op: `infer_narrative_promises`

- Role: `classifier`, temperature 0  
- Input: scene summaries + cue/cast character list (names+ids) + existing worldRules text, all `<source_data>`  
- Output §2a `NarrativePromises`:

```ts
{
  threads: [{
    label, summary, status, // open|paid_off|abandoned
    ownerNames: string[],   // server resolves → ids
    setupSceneId, payoffSceneId | null,
    setupQuote, payoffQuote
  }],
  sceneMotivations: [{
    sceneId,
    motivations: [{ characterName, objective, stakes, obstacle }]
  }],
  worldRules: [{
    text, limit, cost, exception,
    evidenceSceneId | null, evidenceQuote
  }]
}
```

Server: mint thread ids; resolve names; drop unresolvable owners/motivations (log counts only); merge world rules into bible (append new; do not overwrite locked rules); write motivations onto matching scenes; attach threads to episode.

**Pipeline:** after `inferring_entities` / before or after `extracting_facts`. Prefer **after entities, before facts** so motivations see the cast. New SSE stage: `inferring_promises`.

**Failure:** one schema retry; then `SCHEMA_INVALID_LLM`, atomic fail (same as acts/entities).

`PROMPT_VERSION` 0.12.0 → **0.13.0**. Real `make evals` required before remote merge (local merge-as-we-go still allowed per user preference; eval debt tracked).

## UI (minimal)

Ledger FilterRail / Atlas: new lens or chapter **Threads** listing open / paid_off / abandoned with setup→payoff scene jump. No Plan connectors yet.

## Acceptance

- Import of a cue-bearing script with planted setup/payoff yields ≥1 thread with resolved owners and setup scene  
- Scene motivations non-empty for at least one planted scene when cast resolves  
- Structured world rule fields persist and round-trip contract  
- Locked world rules untouched on merge  
- Eval fixture + soft recall gates (dry-run); real evals on authorization  
- Unit + import tests; `make check-contract` green  

## Out of band / later

- Plan connector lines  
- P1 knowledge transitions  
- P3 Compile Story using thread status  
