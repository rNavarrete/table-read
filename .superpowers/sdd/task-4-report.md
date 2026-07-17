# Task 4 Report: Eval fixture + gates (T7.17)

## Status

Complete.

## Changes

- Added `fixtures/entity-inference.fountain` + `entity-inference.planted.json`: two alias pairs (Dorothy/Dot, Marguerite/Margo), one non-speaking character (Owen), two implied relationships (never stated literally), two locations, one recurring object.
- Added `entity_inference_eval` + `alias_resolution_eval` to `apps/api/evals/adoption.py` (A2-style minimal-shell pattern, real `fountain.parse.split_into_scenes` / `cues_from_scenes`, real `merge_inferred_entities` for alias resolution).
- Wired both as new soft `SOFT_EVAL_KEYS` families (`entity-inference`, `alias-resolution`) in `evals/suite.py` (`EVAL_KEYS`, `FAMILY_RESULT_NAME`, `nominal_call_estimate`, `run_suite`) and `evals/run.py` (`_ONLY_CHOICES`).
- Gates: entity recall ≥ 0.8 (hallucination-penalized like A2), alias resolution ≥ 0.9 — both soft, never block the hard suite.
- Updated existing eval tests hardcoding family counts/lists (`test_evals_checks.py`, `test_evals_checkpoint.py`) and added new unit tests in `test_adoption_evals.py`, incl. a regression guard that the seeded dry-run response itself resolves both alias pairs.
- `docs/tableread-test-plan.md`: §1 unit bullets for T7.15 (entity merge/alias/lock/atomicity) and T7.16 (cast rename/merge/delete); §3 two new eval rows.
- `docs/tableread-build-plan.md`: T7.17 marked implemented; real `make evals` sign-off still explicitly pending authorization.

## Dry-run result

`make evals-dry` (full, mock): exit 0. New families render `[WARN]` (score 0.200, same as sibling `import-inference`/`act-boundary-quality` soft families under Mock's single-seeded-response default) — expected for dry-run and does not block.

## Verification

- `.venv/bin/python -m pytest` (apps/api): 850 passed.
- `ruff check` on all touched Python files: clean.
- Did not run `make evals` (not authorized).

## Concerns

- Dry-run WARN scores reflect `MockLlmClient.set_responses` only seeding the *first* call per family (existing A2 pattern); real-API recall/alias numbers are unverified until the authorized `make evals` run.

## Commit

- `evals: entity-inference fixture and gates (T7.17)`

Report path: `.superpowers/sdd/task-4-report.md`
