# Final Fix Report: Coverage Gap Import Test

## Status

**PASS** - fixed the stale route-level import expectation.

## Fix Notes

- Removed the `gap` parametrization from `test_bad_ranges_reject_with_validation_and_persist_nothing`; overlap still rejects with `400 VALIDATION` and persists nothing.
- Added `test_gapped_ranges_heal_persist_and_flag_review` to prove a mid-scene gap returns `200`, persists the imported project text, and emits the beat-level review/tension flag for the healed line.

## Verification

Command: `cd apps/api && .venv/bin/pytest tests/test_import.py -q --tb=short`

Result:

```text
...................                                                      [100%]
19 passed in 0.67s
```
