# Task 3 Report: Truthful wizard progress, elapsed time, and ETA

## Status

Implemented the import wizard progress model and UI wiring:

- Added pure `importProgress.ts` with `advanceImportProgress`, `formatElapsed`, `estimateRemainingMs`, monotonic counters, stage completion semantics, capped ETA samples, stale ETA hiding, and extraction-total seeding from segmentation.
- Updated `ImportWizard` to consume `stage`, `progress`, and `complete` SSE frames through the pure model.
- Added heavy-stage counters and progress bars, elapsed timer, ETA/estimating/stale display, and throttled `aria-live` announcements.
- Did not touch server, prompts, or evals.

## TDD Evidence

Initial RED:

- Command: `node /Users/rolandonavarrete/Documents/tableread/node_modules/vitest/vitest.mjs run src/projects/wizard/importProgress.test.ts src/projects/wizard/ImportWizard.test.tsx`
- Result: failed as expected.
- Evidence:
  - `Cannot find module './importProgress'` from `importProgress.test.ts`.
  - `Unable to find an element with the text: 5 of 10` from the wizard UI test.

Regression RED found during self-review:

- Command: `node /Users/rolandonavarrete/Documents/tableread/node_modules/vitest/vitest.mjs run src/projects/wizard/importProgress.test.ts`
- Result: failed as expected.
- Evidence: duplicate `stage` frame incorrectly completed `segmenting_beats`.

GREEN:

- Command: `node /Users/rolandonavarrete/Documents/tableread/node_modules/vitest/vitest.mjs run src/projects/wizard/importProgress.test.ts src/projects/wizard/ImportWizard.test.tsx`
- Result: `2 passed`, `17 passed`.
- Command: `node /Users/rolandonavarrete/Documents/tableread/node_modules/vitest/vitest.mjs run src/projects/wizard/`
- Result: `8 passed`, `33 passed`.
- Command: `node /Users/rolandonavarrete/Documents/tableread/node_modules/eslint/bin/eslint.js src/projects/wizard/importProgress.ts src/projects/wizard/importProgress.test.ts src/projects/wizard/ImportWizard.tsx src/projects/wizard/ImportWizard.test.tsx`
- Result: exit 0.
- Command: `node /Users/rolandonavarrete/Documents/tableread/node_modules/prettier/bin/prettier.cjs --check src/projects/wizard/importProgress.ts src/projects/wizard/importProgress.test.ts src/projects/wizard/ImportWizard.tsx src/projects/wizard/ImportWizard.test.tsx`
- Result: `All matched files use Prettier code style!`
- IDE diagnostics: no linter errors for touched files.

## Extra Verification

- Command: `node /Users/rolandonavarrete/Documents/tableread/node_modules/typescript/bin/tsc -b`
- Result: failed on existing repo-wide type errors outside this task, including stale project fixtures missing `defaultCraftLevel`, existing `PlanScreen` / `ReviewScreen` nullability errors, and existing review/write test fixture shape errors. No reported TypeScript errors pointed at the four touched wizard files.

## Self-Review Notes

- Confirmed stage start completes only a different prior stage, never itself, including duplicate stage frames.
- Confirmed `complete` advances the current stage before navigation.
- Confirmed progress counters use max-clamping so duplicate/out-of-order `progress` frames do not regress counters or samples.
- Confirmed ETA uses at most 11 samples / latest 10 intervals, starts only after 5 completed scene units, combines remaining segmentation plus extraction units, seeds extraction total from segmentation before the first extraction event, and hides after `>30s` stale while elapsed remains.
- Confirmed `aria-live` changes on stage events and every 10th completion while visual counters update on every progress frame.
