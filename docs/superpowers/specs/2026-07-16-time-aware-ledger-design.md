# Time-Aware Ledger (P1, slice 1) — Design

**Date:** 2026-07-16  
**Status:** Approved direction (roadmap P1); this slice is the first shippable cut  
**Parent:** `docs/superpowers/specs/2026-07-16-continuity-layer-roadmap-design.md` §P1  
**Build-plan:** T7.18

## Goal

The ledger can answer: **what was true as of scene N** — using data we already store (`sourceSpan.sceneId`, supersede chain, episode scene order). No new LLM op in this slice.

## Non-goals (later P1 slices)

- Relative-time extraction ("three days later") as first-class timeline anchors  
- Scene-anchored `knownBy` *transitions* (who learns when) as separate rows  
- Relationship-state history beyond today’s static bible relationships  
- Object custody / location continuity compiler checks  
- Prompt / `PROMPT_VERSION` changes

## Semantics

Given an episode’s ordered scenes `S[0..n]` and a target `asOfSceneId = S[k]`:

A fact is **in force as of S[k]** when:

1. Its establishing scene is at or before `k` (index of `sourceSpan.sceneId` in that episode’s scene list), **and**
2. Its status is `active` or `pending_review` or `writer`-visible statuses we already show in Ledger (same status filter as today’s GET, applied after as-of), **and**
3. If it was superseded, the superseding fact’s establishing scene is **after** `k` (so the old fact still holds at `k`); if the superseder was established at or before `k`, the old fact is out of force.

Facts whose `sourceSpan.sceneId` is missing from the episode (orphan) are excluded from as-of results.

Audience/character lenses and Atlas/Web continue to apply on the filtered set.

## API

`GET /projects/{pid}/ledger?asOfScene={sceneId}` (optional query param)

- Omit → current behavior (no temporal filter).  
- Present → filter with the semantics above, then existing `status` / character filters if any.  
- Unknown `sceneId` → 404 `NOT_FOUND` or 400 `VALIDATION` (match project conventions).

No schema change to `LedgerFact`. Contract documents the query param.

## UI

Ledger FilterRail (or header): optional **As of** scene selector (episode scene list). Clearing restores full ledger. Preference may be session-only in this slice (no persistence required).

## Acceptance

- Unit tests cover: established later → excluded; superseded after → still in; superseded before → out; orphan scene → out.  
- API integration test with fixture/long-pour ordering.  
- UI: selecting a scene shrinks the fact list; clearing restores.  
- No `PROMPT_VERSION` bump; `make check-contract` green if contract docs touch query docs only.
