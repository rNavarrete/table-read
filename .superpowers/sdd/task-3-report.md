### Task 3 Report

Status: complete.

Implemented:
- Added shared `WizardShell` routes for `/projects/new/idea` and `/projects/new/import` with placeholder step bodies, Back/Continue/Cancel controls, visible step labels, first-invalid focus handling, and the required trust note.
- Added exact `FORMAT_PRESETS` values mapped to `ShowFormat`.
- Added versioned browser-local draft helpers under `tr.wizard.v1.*` plus draft-backed placeholder idea/import wizard fields.
- Updated the dashboard so launcher cards deep-link directly and the top-right `+ New project` button opens a path chooser.
- Removed the old `NewProjectStub`.

Verification:
- Red tests were added first for presets, draft round-trip, shell navigation/focus behavior, dashboard chooser, and app wizard routes.
- `npm --workspace apps/web test -- src/projects/wizard/FormatPresets.test.ts src/projects/wizard/wizardDraft.test.ts src/projects/wizard/WizardShell.test.tsx src/projects/DashboardScreen.test.tsx src/App.test.tsx`
- `npm --workspace apps/web test`
- `npm --workspace apps/web run lint`

Concerns:
- Idea creation and import execution remain intentionally placeholder-only for Tasks 4 and 5.
