# Task 4 Report: Docs + Tesseract bootstrap + optional e2e

## Status

Complete.

## Changes

- Updated authority docs for the PDF import MVP: single-episode PDF now follows extract -> confirm source -> existing Create & analyze as `format: "text"`.
- Marked `docs/superpowers/specs/2026-07-12-pdf-import-design.md` as approved.
- Updated the new-project-flow design non-goals so PDF is the explicit approved exception while FDX/RTF/Final Draft/Word remain out of scope.
- Added Makefile bootstrap notes for system Tesseract + English data:
  - macOS: `brew install tesseract`
  - Debian/Ubuntu: `apt install tesseract-ocr tesseract-ocr-eng`
- Fixed `WizardShell` step layout to derive its responsive grid column count from the actual step count, supporting the five-step Import wizard without breaking the four-step Idea wizard.

## Verification

- `make test-js` PASS: 47 web test files / 233 tests; 3 contract test files / 4 tests.
- `make check-gaps` PASS.
- `git diff --check` PASS.
- `ReadLints` on `apps/web/src/projects/wizard/WizardShell.tsx` PASS.

## Known Pre-existing Failures / Skips

- `make lint-js` FAILS on existing unrelated files: `apps/web/src/App.tsx`, `apps/web/src/shell/SettingsPanel.tsx`, and `apps/web/src/write/WriteScreen.tsx`.
- Workspace Prettier check FAILS on existing unrelated/unowned web files, including `apps/web/src/projects/wizard/ImportWizard.tsx` from prior task work. `WizardShell.tsx` was not flagged.
- Optional PDF e2e was skipped as heavy/non-required for this task; docs now record the optional mocked extract-pdf e2e path.

## Commit

- `docs: PDF import extract-confirm path and Tesseract bootstrap`

## Review Follow-up

- Aligned the approved PDF import design spec with the five-step Import wizard / `WizardShell` shape: Add script -> Confirm source -> Confirm basics -> Review source -> Analyze.
- Fixed the cheap related minor in the new-project-flow design goal text so script import includes Fountain/plain-text/PDF.
