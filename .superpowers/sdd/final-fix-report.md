# Final review fix report

## Status

All five final-review findings are addressed with minimal production changes and focused regression coverage.

## Changes

- Added non-coercing Pydantic validation for both `InferredActStart` fields. Integral numeric floats remain accepted and normalize to integers; numeric strings, booleans, fractional values, negatives, and empty `starts` are rejected in Python and Zod parity tests.
- Added focused `caplog` coverage proving the infer-act pipeline log contains only scene/boundary counts, retry state, and prompt version—not scene summaries, locations, or writer text.
- Added Inspector coverage for Act-select disablement under an episode lock and while a patch is pending.
- Added an act-specific optimistic PATCH rollback test using `useProjectPatch`, `buildScenePatch`, and `withSceneField`.
- Preserved field/value correlation with `<K extends keyof Scene>(field: K, value: Scene[K])` through `InspectorProps`, `PlanScreen`, `buildScenePatch`, and `withSceneField`, plus compile-time negative assertions.

## RED evidence

- Python contract regression: `pytest tests/test_contract.py -q` failed exactly two cases because Pydantic accepted `"1"` and `true` (`2 failed, 8 passed`).
- Scene typing regression: the initial compile reported three `TS2578` unused `@ts-expect-error` directives, proving invalid `act`/`locked` values were accepted by the widened `unknown` signatures.
- The Zod parity, log privacy, Act disabled-state, and rollback tests passed when first added. Those findings were missing focused coverage around behavior already implemented, so no runtime production change was warranted for them.

## GREEN evidence

- Focused Python: `13 passed` (`test_contract.py` plus infer-act log privacy).
- Focused contract: `11 passed`.
- Focused Plan: `51 passed`.
- Focused scene-field TypeScript compile: exit 0.
- `make test`: API `803 passed`; web `243 passed` across 48 files; contract `14 passed` across 3 files (`1,060` tests total).
- `make lint`: Ruff, ESLint, Prettier, and DESIGN-GAP checks all passed.
- `make check-contract`: `40 schemas diffed`, both fixture validators passed, tool schemas up to date.
- `make evals-dry`: exit 0; all hard gates passed, including schema validity `1.000`, act-boundary validity `1.000`, and lock violation `1.000`.
- `git diff --check`: exit 0.

## Files

- `apps/api/schemas.py`
- `apps/api/tests/test_contract.py`
- `apps/api/tests/test_import.py`
- `packages/contract/src/index.test.ts`
- `apps/web/src/plan/Inspector.tsx`
- `apps/web/src/plan/Inspector.test.tsx`
- `apps/web/src/plan/PlanScreen.tsx`
- `apps/web/src/plan/planTree.ts`
- `apps/web/src/plan/planTree.test.ts`
- `apps/web/src/plan/useProjectPatch.test.ts`

## Concerns

- Per human override, no E2E and no paid real eval were run. The prompt/tool-schema branch still requires explicitly authorized real-eval sign-off before merge.
- Dry evals emitted the existing soft warnings: `import-inference = 0.200` and `act-boundary-quality = 0.000`; the dry harness exits 0 and all hard gates pass.
- A full `npm run build --workspace=web` remains blocked by unrelated pre-existing TypeScript errors across the branch. The focused scene-field compile passes, and the required test/lint/contract gates are green.
- `.superpowers/sdd/task-3-report.md` and `task-4-report.md` were already modified before this work and are intentionally excluded from this fix commit.
