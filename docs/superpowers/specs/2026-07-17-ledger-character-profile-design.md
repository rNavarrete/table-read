# Ledger character profile (T7.31)

**Date:** 2026-07-17  
**Status:** Implemented (v1)  
**Surface:** Ledger · People filter → profile header above Atlas / Knowledge Web

## Problem

Selecting a person in the Ledger People rail only filters facts (e.g. “Events (2)”). Writers expect a short **profile** for that character — at least a brief summary and a bio — so the bible feels like a cast dossier, not only a filtered fact list.

## Decisions

1. **New Character fields, not craft reuse.** Design-doc craft fields (`embodiment`, `presentation`, `hiding`, `traits`, `seriesArc`) stay drama-manager inputs. Profile prose is separate:
   - `summary` — one-line brief (default `""`)
   - `bio` — short paragraph dossier (default `""`)  
   Defaults keep existing projects and the fixture validating without migration.

2. **No new LLM op / no tool-schema change in v1.** `InferredCharacter` already has `traits`; import merge copies it into `Character.traits` and `Character.summary` when those are empty and the row is unlocked. Dedicated LLM bio generation is deferred (would bump `PROMPT_VERSION` + require `make evals`).

3. **Display resolve with deterministic fallback (no second LLM call).** UI uses `resolveCharacterProfile`:
   1. Stored `summary` / `bio` when non-empty
   2. Else bible craft: `traits` → summary; `presentation` + `hiding` + `embodiment` → bio paragraphs
   3. Else synthesize from that character’s `knownBy` facts (prefer event/state/knowledge) plus scene motivations  
   This gives immediate UX on existing imports **without re-import**. Re-import improves stored `summary` when the classifier returns traits.

4. **Empty state.** If all three layers are empty, show a quiet empty profile (“No profile yet”) above the filtered facts — never invent fake biography.

5. **UI placement.** When People `characterId` is set, render a raised profile card (name, aliases, Summary, Bio) above the Atlas/Web body. Tokens only; match Ledger creative polish. All-people (`null`) shows no profile card.

## Out of scope

- Writer-editable profile form in Cast panel  
- Extending `infer_story_entities` output with `bio` / `summary`  
- Prompt / tool-schema / `PROMPT_VERSION` changes  

## Acceptance

- Zod + Pydantic + data-contract include `Character.summary` / `bio` with defaults  
- People selection shows profile header with summary + bio (stored, bible, or derived)  
- Empty profile state when nothing available  
- Import merge fills `traits`/`summary` from inferred traits when empty  
- UI spec §7 + build-plan T7.31 + unit tests; `make check-contract` green; no `make evals` required for this cut  
