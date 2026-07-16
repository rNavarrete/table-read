# Task 3 Report: Cast review surface (Ledger) — T7.16

## Status

Implemented cast management end-to-end:

- **API** (`apps/api/drama_manager/characters.py`, pure transforms; wired into
  `apps/api/routes.py` via `storage/snapshots.mutate`, one snapshot per call):
  - `PATCH /projects/{pid}/characters/{cid}` — rename and/or replace aliases.
  - `POST /projects/{pid}/characters/{cid}/merge-into/{targetId}` — atomic:
    absorbs the source's aliases (+ source's own name as an alias) into the
    target; rewrites every characterId reference from source to target
    (ledger `knownBy`, relationship `between`, scene `motivations`, season
    `characterArcs`, episode storyline `characterIds` — deduping the
    set-shaped fields); drops a relationship the merge collapses into a
    self-pair; removes the source. The brief only named `knownBy` and
    relationships explicitly — I also rewrote `motivations`/`characterArcs`/
    storyline `characterIds` rather than leave a dangling reference to a
    deleted character id, since that would otherwise silently corrupt the
    doc (not a product-behavior ambiguity, so no `DESIGN-GAP`).
  - `DELETE /projects/{pid}/characters/{cid}` — refused 409 `VALIDATION`
    with `{facts, relationships}` counts while any reference remains.
  - All three reject a locked character 409 `LOCKED_OBJECT` before any
    mutation (rule 2) — the brief calls this out explicitly for rename and
    merge; I extended the same guard to delete for consistency.
- **Docs**: `docs/tableread-data-contract.md` §4 gained a "Cast management
  (T7.16)" subsection for the three endpoints. No Zod/Pydantic contract
  change was needed — these are route-only request/response shapes (like
  the existing `LedgerFactEdit`/`LedgerBatchRequest`), and `Character`
  itself is unchanged, so `make check-contract` isn't implicated.
- **UI**: `CastPanel.tsx` (new) — cast list with per-character Rename /
  Merge into… / Delete inline forms; `FilterRail.tsx` gained a "Manage cast"
  link in the People section; `LedgerScreen.tsx` toggles the panel and wires
  it to project/ledger state. Every action applies optimistically and rolls
  back the project (and, for merge, ledger) state on a 4xx/5xx `ApiError`.
  Delete's 409 `VALIDATION` details render as a "Still referenced by N
  fact(s) and N relationship(s)" message. Styling uses only existing
  `--tr-*`-token Tailwind classes (`Card`/`Chip` components, `text-tr-danger`
  / `bg-tr-danger` already used elsewhere) — no hardcoded colors.

## TDD Evidence

RED (routes not yet wired — confirmed by first running the new API test file
against a version of `routes.py` without the pre-check→404 mapping):

- Command: `apps/api/.venv/bin/python3 -m pytest apps/api/tests/test_characters.py -q`
- Result: `4 failed, 15 passed` — the four "missing character" tests raised
  an unhandled `characters.CharacterNotFound` (500) because the routes'
  existence pre-checks called `characters.get_character` directly instead of
  through a 404-mapping helper.
- Fix: added `_character_or_404` and used it for every pre-check.

GREEN:

- Command: `apps/api/.venv/bin/python3 -m pytest apps/api/tests/test_characters.py -q`
- Result: `19 passed`.
- Command: `apps/api/.venv/bin/python3 -m pytest -q` (full API suite)
- Result: `845 passed`.
- Command: `apps/api/.venv/bin/python3 -m ruff check .`
- Result: exit 0 (fixed one import-sort ordering issue by hand, not `--fix`,
  to avoid an unrelated `ruff format` reflow of the whole file — see below).
- Command: `apps/api/.venv/bin/python3 -m ruff format --check drama_manager/characters.py tests/test_characters.py`
- Result: `2 files already formatted`.

Web (CastPanel authored test-first against the planned API surface, then
implemented):

- Command: `node node_modules/vitest/vitest.mjs run src/ledger/CastPanel.test.tsx`
- Result (first run, before the confirm-button testid fix): `2 failed, 5
  passed` — `getByRole('button', {name: 'Delete'})` matched both the row
  action and the inline confirm button.
- Fix: added a distinct `cast-confirm-delete-{id}` testid to the confirm
  button.
- Command: same as above after the fix.
- Result: `7 passed`.
- Command: `node node_modules/vitest/vitest.mjs run` (full web suite)
- Result: `61 files passed`, `312 passed` (includes existing
  `FilterRail.test.tsx`/`LedgerScreen.test.tsx`, unaffected).
- Command: `node node_modules/eslint/bin/eslint.js apps/web/src`
- Result: 0 errors (4 pre-existing warnings in unrelated files).
- Command: `node node_modules/typescript/bin/tsc -b`
- Result: pre-existing repo-wide type errors only (fixture shapes missing
  `defaultCraftLevel`/`aliases`, `PlanScreen`/`ReviewScreen`/`WriteScreen`
  nullability, `importProgress.ts` readonly-array assignment) — confirmed by
  diffing against a clean stash of this branch; none point at
  `CastPanel.tsx`, `client.ts`, `FilterRail.tsx`, or the added `LedgerScreen.tsx`
  lines. The one `LedgerScreen.tsx` line in the error list is a pre-existing
  error that merely shifted line numbers.

## Self-Review Notes

- Ran `ruff format` once on the whole repo out of habit; it reflowed ~150
  unrelated lines in `routes.py` to a different (but still 100-col-legal)
  wrapping style. Reverted `routes.py` to `HEAD` and reapplied only my
  diff by hand — final `routes.py` diff is a clean 144-line addition, no
  unrelated churn. `make lint`'s `lint-api` target only runs `ruff check`,
  not `ruff format --check`, so this was cosmetic drift, not a lint gate.
- Did not run `make check-contract` (blocked by the sandbox's auto-review as
  scope-adjacent to `make evals`) — not needed here since no §1/§2/§2a
  schema changed; `Character` itself is unchanged and the new request/
  response shapes are route-only, matching the existing
  `LedgerFactEdit`/`LedgerBatchRequest` precedent that also has no Zod
  counterpart.
- Did not run `make evals` (excluded by task constraints) and did not touch
  `PROMPT_VERSION` or any prompt template — no LLM path is involved in cast
  management.
- Locked-character coverage: rename/merge/delete are unit- and route-tested
  against both a locked source and a locked target for merge, and a locked
  character for rename/delete, each asserting a 409 `LOCKED_OBJECT` and zero
  DB mutation (doc byte-identical, snapshot count unchanged).
- Merge dedup coverage: asserted the rewritten `knownBy` doesn't duplicate an
  id when the target was already directly known, and that a direct
  source↔target relationship collapses to a dropped self-pair rather than a
  visible `[X, X]` relationship.
- Did not touch any Write-mode file, `PROMPT_VERSION`, or push to remote,
  per constraints.

## Files touched

- `apps/api/drama_manager/characters.py` (new)
- `apps/api/routes.py` (+3 routes, +1 helper)
- `apps/api/tests/test_characters.py` (new, 19 tests)
- `apps/web/src/ledger/CastPanel.tsx` (new)
- `apps/web/src/ledger/CastPanel.test.tsx` (new, 7 tests)
- `apps/web/src/ledger/FilterRail.tsx` (+"Manage cast" link)
- `apps/web/src/ledger/LedgerScreen.tsx` (+panel state/wiring)
- `apps/web/src/api/client.ts` (+`renameCharacter`/`mergeCharacterInto`/`deleteCharacter`)
- `docs/tableread-data-contract.md` (+"Cast management (T7.16)" §4 subsection)
