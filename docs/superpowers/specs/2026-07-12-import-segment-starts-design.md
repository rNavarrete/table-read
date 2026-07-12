# Typed segment-start import normalization — design spec

**Date:** 2026-07-12
**Status:** implemented; required real-eval sign-off passed (`PROMPT_VERSION` 0.10.0)
**Supersedes:** the range-coverage behavior in `2026-07-12-import-coverage-cost-design.md`; its cost-preview decisions remain active.

## Goal

Make import text integrity unconditional. The model proposes beat quality; the server alone constructs the exact partition of every scene's source lines.

## In scope

- Replace inclusive beat/unassigned ranges with typed `beat | unassigned` segment starts.
- Send source as `{lineNumber, text}` objects.
- Derive end lines server-side; normalize malformed semantic starts deterministically.
- Retry a severely repaired scene once and retain the lower-repair attempt.
- Surface every repair in the selected attempt as a stable-code review flag.
- Update Zod, Pydantic, data contract, prompt summary, generated tool schema, tests, `PROMPT_VERSION`, and real eval sign-off together.

## Contract

`SegmentedScene` contains `segments`. A beat has `kind`, `startLine`, and its three plan fields. An unassigned segment has `kind`, `startLine`, and `reason`. `startLine` is statically at least 1; the dynamic scene upper bound and ordering remain server semantics.

Each segment owns `startLine..next.startLine-1`; the last owns through `K`.

## Normalization

1. Sort whole segment objects by start, retaining attached metadata.
2. Discard starts above `K`; record `out_of_bounds_start` and discarded beat-metadata count.
3. Collapse duplicate starts to one unassigned segment; record `duplicate_start` and discard all conflicting beat metadata.
4. If the first usable start is greater than 1, prepend unassigned start 1 and record `missing_initial_start`.
5. If no usable starts remain, create one unassigned start 1 and record `empty_output` or `no_valid_segments`.
6. Derive ends, slice source verbatim, and merge unassigned runs into the nearest beat.

The selected output always partitions `1..K`. Repairs never fabricate writer text or beat metadata.

## Retry and attempt selection

Retry the same scene exactly once when the first attempt has any of:

- empty output;
- duplicate start;
- discarded beat metadata; or
- `affectedLines / K > 0.05`.

The retry prompt includes only repair codes/counts and the same inert source. Normalize both attempts and select the lower tuple:

`(discardedBeatMetadata, affectedLines, maxBoundaryDisplacement, repairEventCount)`

The first attempt wins an exact tie. Rule 9's one schema-invalid retry remains separate.

## Review flags

Stable codes are `model_unassigned`, `duplicate_start`, `missing_initial_start`, `empty_output`, `no_valid_segments`, `out_of_bounds_start`, and `unordered_segments`. Only issues from the selected attempt are persisted. Logs contain line counts, repair counts, scores, model/prompt identifiers, and hashes—never source or plan text.

## Non-goals

- Import-job caching/checkpointing. T7.11 will specify hashing, expiry, purge/privacy, and atomic-import interaction separately.
- OCR reflow, false-slugline recovery, giant-line handling, or character-offset segmentation.
- Changing the existing cost-preview UI beyond documenting that `2N+1` is nominal and a scene may add one semantic retry.

## Acceptance

- Byte-identical reconstruction for valid, duplicate, OOB, empty, missing-first, unordered, and explicit-unassigned outputs.
- Scoped retry predicate and lexicographic selection are unit/integration tested.
- Import lock guard proves zero segmentation calls for locked targets.
- Contract and generated schemas are synchronized.
- `make test`, `make lint`, `make check-contract`, and authorized `make evals` pass before merge.
