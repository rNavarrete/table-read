# Import character mint — Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** Mint `seriesBible.characters` from Fountain cues during import and normalize ledger `knownBy` to character ids (platform fix; existing projects re-import).

**Architecture:** Pure helpers in `apps/api/fountain/characters.py`; wire into `analyze_import` before extract; post-extract normalize in `_to_ledger_fact` path; one-shot mutate script for existing projects.

**Tech Stack:** Python 3.12, existing snapshots/import pipeline, pytest.

## Global Constraints

- No new LLM op / no `PROMPT_VERSION` bump
- Character ids: `char-{uuid.hex}` like foundation
- DESIGN-GAP/build-plan must reference T7.14
- Every mutation via `snapshots.mutate` / import root snapshot only

---

## Task 1: Pure helpers + unit tests

**Files:**

- Create: `apps/api/fountain/characters.py`
- Create: `apps/api/tests/test_fountain_characters.py`

- [ ] Cue extraction, title-case, merge mint, knownBy normalize
- [ ] Tests for transitions filtered, DOC/MARTY cues, Doc→id, audience dropped, Doc Brown↔Doc alias

## Task 2: Wire import pipeline

**Files:**

- Modify: `apps/api/fountain/pipeline.py`
- Modify: `apps/api/tests/test_import.py` (or focused new tests)

- [ ] After `_install_scenes`, mint/merge characters from scene scripts
- [ ] Re-read `characters` for extract/scan
- [ ] Normalize `knownBy` when building ledger facts (may mint extras into bible)
- [ ] Assert import yields non-empty characters for cue-bearing fixture text

## Task 3: Existing projects — superseded

Per the spec (§B) and the continuity-layer roadmap policy, already-imported
projects adopt this by **re-import**; no per-project backfill script ships.
The originally planned `backfill_import_characters.py` is dropped.

## Task 4: Docs

**Files:**

- Modify: `docs/tableread-build-plan.md` (T7.14)
- Spec already at `docs/superpowers/specs/2026-07-16-import-character-mint-design.md`

- [ ] Add T7.14 acceptance bullets
