# Import character mint (MVP) — Design

**Date:** 2026-07-16  
**Status:** Approved (heuristic slice)  
**Build-plan task:** T7.14

## Problem

Import leaves `seriesBible.characters` empty. Ledger Knowledge Web PEOPLE chips and character focus require that list. Fact extraction still emits `knownBy` as display names, so ~99% of facts never appear under Audience focus and cannot be focused by person.

## Goal

**Platform behavior:** every script import (create-and-import and re-import) seeds `seriesBible.characters` from speakers and stores `knownBy` as character ids so Ledger PEOPLE / Knowledge Web work without per-project patches.

## Non-goals

- Full design-doc §4.8 bible reverse-engineer (relationships, theme, arcs, motivations)
- New LLM op / `PROMPT_VERSION` bump / evals
- New import SSE stage
- Auto-merging duplicate people beyond simple name/alias match

## Authority note

Design doc §4.8 asks for bible reverse-engineering on import. New-project-flow design listed automatic bible reverse-engineering as a non-goal. This MVP is the narrow unblocker (characters + `knownBy` ids only), tracked as T7.14 — not the full reverse-engineer.

## Approach

### A — New imports

1. After scene assembly, before `extracting_facts`, scan all beat `scriptText` for Fountain character cues (ALL-CAPS speaker lines).
2. Merge into `seriesBible.characters` (preserve existing / locked; add missing names). Ids: `char-{uuid.hex}` (same as idea-path foundation).
3. Run extract with that character list in the prompt.
4. When persisting facts, normalize `knownBy`: map ids/names/aliases → character ids; drop `audience` (use `audienceKnows` only); mint any remaining name-like knower into the bible so facts are not orphaned.

### B — Already-imported projects (optional, not the product fix)

Re-import the script after this lands, or run a one-shot mutate using the same helpers. Do not treat per-project backfills as the platform solution.

## Character-cue heuristic

A line is a cue when the name token is ALL-CAPS (letters/digits/`.'-`/spaces), optional parenthetical `(V.O.)` / `(O.S.)` / `(CONT'D)`, and it is not a slugline or transition (`CUT TO:`, `FADE OUT`, `TITLE`, etc.). Display name = title-case of the cue token.

## Acceptance

- Import of a script with cues → `seriesBible.characters` non-empty; PEOPLE shows names
- Persisted import facts: every `knownBy` entry is a project character id (or empty)
- Re-import merges speakers; does not wipe existing characters
- Locked characters are never overwritten
- Create-and-import still one root snapshot / zero rows on failure

## Out of band

Relationships, world-rule quality, and “atomic lies” extraction quality remain separate iteration work.
