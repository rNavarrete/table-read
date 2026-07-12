# Task 3 Report: Import wizard PDF confirm-source

## Status

Implemented the web PDF import flow:

- Added `extractPdf(file)` client for `POST /api/v1/projects/import/extract-pdf`.
- Updated the import wizard to accept `.pdf`, extract PDF text on select, and store PDF metadata.
- Added a required editable Confirm source step before project basics.
- Shows `Text layer` / `OCR` badges and PDF warnings where available.
- Keeps Create & analyze on the existing import SSE path with `source.format: "text"` and the writer-edited source content.

## TDD

Red check:

- `npm exec -- vitest run src/api/client.test.ts src/projects/wizard/ImportWizard.test.tsx`
- Expected failures observed for missing `extractPdf`, missing PDF acceptance/extraction, and old unsupported-file copy.

Green checks:

- `npm exec -- vitest run src/api/client.test.ts src/projects/wizard/ImportWizard.test.tsx`
- `17 passed`
- `npm exec -- prettier --check .worktrees/pdf-import/apps/web/src/api/client.ts .worktrees/pdf-import/apps/web/src/api/client.test.ts .worktrees/pdf-import/apps/web/src/projects/wizard/ImportWizard.tsx .worktrees/pdf-import/apps/web/src/projects/wizard/ImportWizard.test.tsx`
- `All matched files use Prettier code style!`
- `npm exec -- eslint .worktrees/pdf-import/apps/web/src/api/client.ts .worktrees/pdf-import/apps/web/src/api/client.test.ts .worktrees/pdf-import/apps/web/src/projects/wizard/ImportWizard.tsx .worktrees/pdf-import/apps/web/src/projects/wizard/ImportWizard.test.tsx`
- Exit 0

## Concerns

- The nested worktree sits under the parent checkout, so npm/Vitest reports the parent repo root in output. Commands were run with explicit worktree paths or from the worktree app directory so the changed files were exercised.
