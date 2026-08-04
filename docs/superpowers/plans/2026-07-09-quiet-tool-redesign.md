# Quiet Tool Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the entire Table Read web app to the Quiet Tool visual language (cool neutrals, slate-blue accent, Instrument Sans) while keeping all existing product logic and Review-as-a-full-mode behavior.

**Architecture:** Remap `--tr-*` token _values_ (keep names so Tailwind classes like `bg-tr-coral` keep working). Update UI spec §1 to match. Then restyle shell and each mode against the handoff chrome, without changing routes, APIs, or Change Set flows. Source of truth: `docs/superpowers/specs/2026-07-09-quiet-tool-redesign-design.md`.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind v4 (`apps/web`), CSS custom properties in `tokens.css`, Vitest + Playwright.

## Global Constraints

- CLAUDE.md hard rule 6: no hardcoded hex/spacing in components — tokens only (`--tr-*`).
- Keep `--tr-coral*` **names**; values become slate-blue (`#5B79A6` / `#4A6690` / `#DEE5EE`).
- Review stays a full mode (`/review`); do **not** implement Plan-scrim modal or impact-map radial.
- Do not copy handoff HTML into the repo as a runtime asset.
- Each task ends with lint + relevant tests green and a commit.
- Update `docs/tableread-ui-spec.md` when tokens/chrome change (Task 1 owns §1; later tasks adjust §2–§6 descriptions as they touch those surfaces).

---

## File map

| Area   | Primary files                                                                                                                                                                 |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tokens | `apps/web/src/styles/tokens.css`, `tokens.expected.ts`, `tokens.test.ts`, `dev/TokensPage.tsx`, `dev/TokensPage.test.tsx`, `apps/web/index.html`, `docs/tableread-ui-spec.md` |
| Shell  | `shell/AppShell.tsx`, `shell/ModeSwitcher.tsx`, `shell/ModeSwitcher.test.tsx`, `shell/SettingsPanel.tsx`                                                                      |
| Write  | `write/WriteScreen.tsx`, `ScriptCanvas.tsx`, `CandidateCard.tsx`, `CandidateDock.tsx`, `CommandBar.tsx`                                                                       |
| Plan   | `plan/PlanScreen.tsx`, `Board.tsx`, `SceneCard.tsx`, `StoryLayersPanel.tsx`, `Inspector.tsx`, `Card.tsx`, `Chip.tsx`, `LockToggle.tsx`, `BeatCard.tsx`                        |
| Ledger | `ledger/LedgerScreen.tsx`, `FilterRail.tsx`, `FactCard.tsx`, `ConfidenceBar.tsx`                                                                                              |
| Review | `review/ReviewScreen.tsx`, `ChangeSetPanel.tsx`, `ChangeSetRow.tsx`, `DiffPane.tsx`                                                                                           |

---

### Task 1: Tokens, fonts, UI spec §1

**Files:**

- Modify: `apps/web/src/styles/tokens.expected.ts`
- Modify: `apps/web/src/styles/tokens.css`
- Modify: `apps/web/index.html`
- Modify: `apps/web/src/dev/TokensPage.tsx` (descriptions that still say “coral” / warm ivory)
- Modify: `docs/tableread-ui-spec.md` (§1 token block + type comments)
- Test: `apps/web/src/styles/tokens.test.ts`, `apps/web/src/dev/TokensPage.test.tsx`

**Interfaces:**

- Produces: Quiet Tool values for every existing `--tr-*` token; optional new `--tr-accent-ink: #33445E` and `--tr-shell-height: 52px` if added (must appear in `EXPECTED_TOKENS` + `@theme` if used by utilities)

- [ ] **Step 1: Update `EXPECTED_TOKENS` to Quiet Tool values (failing test first)**

Replace color/font/radius/shadow/layout entries in `apps/web/src/styles/tokens.expected.ts` with:

```ts
export const EXPECTED_TOKENS: Record<string, string> = {
  '--tr-surface-page': '#F6F6F3',
  '--tr-surface-raised': '#FFFFFF',
  '--tr-surface-sunken': '#F0F0EC',
  '--tr-surface-clay': '#EBEBE6',
  '--tr-border': '#E8E8E2',
  '--tr-border-strong': '#D9D9D2',

  '--tr-text-primary': '#26272B',
  '--tr-text-secondary': '#84857D',
  '--tr-text-muted': '#9a9b92',

  '--tr-coral': '#5B79A6',
  '--tr-coral-hover': '#4A6690',
  '--tr-coral-soft': '#DEE5EE',

  '--tr-sage': '#7D9678',
  '--tr-sage-soft': '#E7EEE4',
  '--tr-sky': '#41608A',
  '--tr-sky-soft': '#E4EBF2',
  '--tr-amber': '#8A6120',
  '--tr-amber-soft': '#FBF4E6',
  '--tr-danger': '#B0503C',

  '--tr-font-ui': '"Instrument Sans", system-ui, sans-serif',
  '--tr-font-script': '"Courier Prime", "Courier New", monospace',
  '--tr-font-display': '"Instrument Sans", system-ui, sans-serif',

  '--tr-font-size-12': '12px',
  '--tr-font-size-13': '13px',
  '--tr-font-size-15': '15px',
  '--tr-font-size-17': '17px',
  '--tr-font-size-22': '22px',
  '--tr-font-size-28': '28px',

  '--tr-radius-card': '12px',
  '--tr-radius-chip': '999px',
  '--tr-radius-frame': '12px',

  '--tr-shadow-raised': '0 1px 2px rgb(38 39 43 / 0.04)',
  '--tr-shadow-lift': '0 4px 16px rgb(38 39 43 / 0.08)',

  '--tr-motion-duration-standard': '160ms',
  '--tr-motion-ease-standard': 'ease-out',

  '--tr-script-col': '600px',
  '--tr-panel-story-layers': '232px',
  '--tr-panel-inspector': '296px',
  '--tr-card-scene': '214px',
  '--tr-panel-ledger-filters': '198px',

  '--tr-outline-selected': '2px',
  '--tr-opacity-locked': '0.55',

  // Quiet Tool selected-pill ink + shell height
  '--tr-accent-ink': '#33445E',
  '--tr-shell-height': '52px',
}
```

If adding `--tr-accent-ink` / `--tr-shell-height`, also extend `themeKeyFor` in `tokens.test.ts` so non-color tokens map correctly (e.g. shell height → `--spacing-shell-height` or a dedicated `@theme` alias — prefer `--spacing-shell-height: var(--tr-shell-height)` and use `h-shell-height` / `min-h-shell-height`).

- [ ] **Step 2: Run token tests — expect FAIL**

Run: `cd apps/web && npx vitest run src/styles/tokens.test.ts src/dev/TokensPage.test.tsx`

Expected: FAIL — `tokens.css` still has old ivory/coral/Fraunces values (and missing new tokens if added).

- [ ] **Step 3: Update `tokens.css` `:root` + `@theme` to match `EXPECTED_TOKENS`**

Mirror every value from Step 1 into `apps/web/src/styles/tokens.css`. Update the file header comment to say Quiet Tool / cool paper / slate accent. Wire new tokens in `@theme`:

```css
--color-tr-accent-ink: var(--tr-accent-ink);
--spacing-shell-height: var(--tr-shell-height);
```

Update `TokensPage.tsx` group descriptions that still say “warm ivory”, “muted coral”, “Fraunces”, etc.

- [ ] **Step 4: Load Instrument Sans + Courier Prime in `index.html`**

Add Google Fonts (or self-host if the repo prefers no CDN — Google Fonts is fine for MVP):

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&family=Instrument+Sans:wght@400;500;600&display=swap"
  rel="stylesheet"
/>
```

- [ ] **Step 5: Update `docs/tableread-ui-spec.md` §1**

Replace the `:root { ... }` block and type comments with Quiet Tool values (same as `EXPECTED_TOKENS`). Note that `--tr-coral*` names remain for primary accent (slate-blue values). State Review remains a full mode (do not rewrite §5 as a modal in this task — only §1).

- [ ] **Step 6: Re-run tests + lint**

Run: `cd apps/web && npx vitest run src/styles/tokens.test.ts src/dev/TokensPage.test.tsx && cd ../.. && make lint`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/styles/tokens.css apps/web/src/styles/tokens.expected.ts apps/web/src/styles/tokens.test.ts apps/web/index.html apps/web/src/dev/TokensPage.tsx docs/tableread-ui-spec.md
git commit -m "$(cat <<'EOF'
web: Quiet Tool design tokens and Instrument Sans

Remap --tr-* values to cool paper / slate accent; keep coral* names;
load Instrument Sans + Courier Prime; update UI spec §1.
EOF
)"
```

---

### Task 2: App shell + mode switcher

**Files:**

- Modify: `apps/web/src/shell/AppShell.tsx`
- Modify: `apps/web/src/shell/ModeSwitcher.tsx`
- Modify: `apps/web/src/shell/ModeSwitcher.test.tsx` (only if assertions depend on old class names)
- Modify: `docs/tableread-ui-spec.md` §2 (56px → 52px, accent-tint active segment)

**Interfaces:**

- Consumes: `--tr-shell-height`, `--tr-coral-soft`, `--tr-accent-ink`, `--tr-surface-clay`
- Produces: Quiet Tool chrome; behavior unchanged (Undo/Export/Settings/⌘1–4/dots)

- [ ] **Step 1: Restyle `AppShell` header to 52px Quiet Tool bar**

Change the header from `h-14` to `h-shell-height` (or `h-[var(--tr-shell-height)]` only if theme alias missing — prefer token utility). Title: drop reliance on Fraunces look — use `font-ui` / `font-display` (now both Instrument Sans) at `text-17` weight 600. Keep Undo/Export/Settings muted.

Example header classes:

```tsx
<header className="flex h-shell-height items-center gap-6 bg-tr-surface-sunken px-6">
  <h1 className="font-display text-17 font-semibold text-tr-text-primary">
    {projectTitle}
  </h1>
  {/* ModeSwitcher + utilities unchanged structurally */}
</header>
```

- [ ] **Step 2: Restyle `ModeSwitcher` active state to accent-tint + accent ink**

Active segment:

```tsx
? ' bg-tr-coral-soft text-tr-accent-ink'
```

Track stays `bg-tr-surface-clay`. Inactive hover: `hover:bg-tr-surface-raised`. Amber Review dot / Ledger badge unchanged.

- [ ] **Step 3: Update UI spec §2** to 52px bar and Quiet Tool switcher language.

- [ ] **Step 4: Run shell-related tests + lint**

Run: `cd apps/web && npx vitest run src/shell && cd ../.. && make lint`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/shell/AppShell.tsx apps/web/src/shell/ModeSwitcher.tsx apps/web/src/shell/ModeSwitcher.test.tsx docs/tableread-ui-spec.md
git commit -m "$(cat <<'EOF'
web: Quiet Tool app shell and mode switcher

52px sunken bar; active segment uses accent-tint + accent ink.
EOF
)"
```

---

### Task 3: Write mode chrome

**Files:**

- Modify: `apps/web/src/write/WriteScreen.tsx`
- Modify: `apps/web/src/write/ScriptCanvas.tsx`
- Modify: `apps/web/src/write/CandidateCard.tsx`
- Modify: `apps/web/src/write/CandidateDock.tsx`
- Modify: `apps/web/src/write/CommandBar.tsx`
- Modify: `docs/tableread-ui-spec.md` §3 (720 → 600 script col, dock ~332px if documented)
- Test: existing `write/*.test.tsx` (update class assertions only if they pin old widths/colors)

**Interfaces:**

- Consumes: `--tr-script-col` (600px), `--tr-coral*`, raised surface, lift shadow
- Produces: Quiet Tool Write layout; Accept/Tune/Skip/SSE/quiet-AI logic unchanged

- [ ] **Step 1: Script sheet + command bar Quiet Tool chrome**

`ScriptCanvas`: keep `max-w-script-col`; ensure white raised sheet + soft `shadow-raised`. Adjust padding if needed for denser teleplay look; do not change Fountain parsing.

`CommandBar`: floating pill feel — `rounded-card` / full pill radius via chip radius if appropriate, white raised surface, hairline border, placeholder copy already “Tell the scene where to go…”. Primary submit uses `bg-tr-coral hover:bg-tr-coral-hover`.

- [ ] **Step 2: Candidate dock + cards**

Dock width: if hardcoded, replace with a token or Tailwind spacing — prefer minting `--tr-panel-candidate-dock: 332px` in tokens (requires Task 1 follow-up OR add in this task with expected-token update). If avoiding new token, use `w-[332px]` **only if** UI spec documents it and you add `--tr-panel-candidate-dock` in the same commit (rule 6 — prefer token).

`CandidateCard`: Accept solid accent; Tune outlined (`border border-tr-border` or `border-tr-coral`); Skip text `opacity-60`. Hover: `hover:shadow-lift hover:-translate-y-px` with `motion-reduce` guards.

- [ ] **Step 3: Run write tests + lint**

Run: `cd apps/web && npx vitest run src/write && cd ../.. && make lint`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/write apps/web/src/styles/tokens.css apps/web/src/styles/tokens.expected.ts docs/tableread-ui-spec.md
git commit -m "$(cat <<'EOF'
web: Quiet Tool Write mode chrome

Script sheet, candidate dock/cards, and command bar restyled; logic unchanged.
EOF
)"
```

---

### Task 4: Plan mode chrome

**Files:**

- Modify: `apps/web/src/plan/Board.tsx`, `SceneCard.tsx`, `StoryLayersPanel.tsx`, `Inspector.tsx`, `Card.tsx`, `Chip.tsx`, `LockToggle.tsx`, `BeatCard.tsx`, `PlanScreen.tsx` as needed
- Modify: `docs/tableread-ui-spec.md` §4
- Test: `plan/*.test.tsx` (e.g. `Board.test.tsx` may assert `outline-tr-coral` — keep valid since accent is still `--tr-coral`)

**Interfaces:**

- Consumes: `--tr-panel-story-layers` 232px, `--tr-panel-inspector` 296px, `--tr-card-scene` 214px, `--tr-coral-soft`, `--tr-accent-ink`
- Produces: Quiet Tool Plan chrome; Open Review / PATCH / locks unchanged

- [ ] **Step 1: Story Layers + Board frames**

Selected tree items: `bg-tr-coral-soft text-tr-accent-ink`. Act frames: `bg-tr-surface-clay` / sunken. Scene cards already `w-card-scene` (now 214px via tokens). Prefer selected soft fill **or** keep `outline-tr-coral` — pick soft fill for handoff alignment; update `Board.test.tsx` / `Card` if selection class changes.

- [ ] **Step 2: Inspector + LockToggle**

Inspector panel `w-panel-inspector`. Primary actions (`Open Review`, Save) use accent. Restyle `LockToggle` toward Quiet Tool pill switch (accent when on) without changing `onChange` / locked semantics.

- [ ] **Step 3: Run plan tests + lint**

Run: `cd apps/web && npx vitest run src/plan && cd ../.. && make lint`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/plan docs/tableread-ui-spec.md
git commit -m "$(cat <<'EOF'
web: Quiet Tool Plan mode chrome

Layers, board, inspector, and lock control restyled; Open Review flow unchanged.
EOF
)"
```

---

### Task 5: Ledger mode chrome

**Files:**

- Modify: `apps/web/src/ledger/LedgerScreen.tsx`, `FilterRail.tsx`, `FactCard.tsx`, `ConfidenceBar.tsx`
- Modify: `docs/tableread-ui-spec.md` §6
- Test: `ledger/*.test.tsx`

**Interfaces:**

- Consumes: `--tr-panel-ledger-filters` 198px, amber/sage soft tokens
- Produces: Quiet Tool Ledger chrome; confirm/edit/reject/batch unchanged

- [ ] **Step 1: Filter rail + queue banner**

Active filter: `bg-tr-coral-soft text-tr-accent-ink`. Queue banner: `bg-tr-amber-soft`. “Accept all high-confidence” stays sage/accent per existing semantics (sage for confirm is fine).

- [ ] **Step 2: Fact cards + confidence bar**

2-column grid density; hairline borders; superseded strikethrough + muted confidence fill. `ConfidenceBar` sage fill on cool paper.

- [ ] **Step 3: Run ledger tests + lint**

Run: `cd apps/web && npx vitest run src/ledger && cd ../.. && make lint`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/ledger docs/tableread-ui-spec.md
git commit -m "$(cat <<'EOF'
web: Quiet Tool Ledger mode chrome

Filter rail, review queue, and fact cards restyled; mutations unchanged.
EOF
)"
```

---

### Task 6: Review mode chrome (full mode, not modal)

**Files:**

- Modify: `apps/web/src/review/ReviewScreen.tsx`, `ChangeSetPanel.tsx`, `ChangeSetRow.tsx`, `DiffPane.tsx`
- Modify: `docs/tableread-ui-spec.md` §5 (Quiet Tool chrome; **keep** “Entered via mode switcher… One Change Set at a time” — do not convert to modal)
- Test: `review/*.test.tsx`, optionally `make e2e` review spec if environment allows

**Interfaces:**

- Consumes: accent buttons, sage/amber chips, locked opacity
- Produces: denser Quiet Tool Review UI; preview/apply/flag/discard/list logic unchanged

- [ ] **Step 1: ChangeSetPanel header + footer**

Quieter header (instruction + chips). Footer: Preview outlined accent; Apply solid accent; Flag only / Discard text. Optional reassurance line under footer: “Nothing changes until you confirm.” (copy only).

- [ ] **Step 2: ChangeSetRow density**

Keep checkbox / lock / flag-only / expand / DiffPane behavior. Tighten typography to ~12.5–13px secondary; before→after as small chips where DiffPane collapsed summary allows — do not remove expand/diff. Locked rows stay `opacity-locked`.

- [ ] **Step 3: Draft picker chrome on `ReviewScreen`**

Open Change Sets list cards: white raised, hairline border, hover accent border — no route/filter changes (`draft,previewing` stays).

- [ ] **Step 4: Run review tests + lint (+ e2e if feasible)**

Run: `cd apps/web && npx vitest run src/review && cd ../.. && make lint`

Optional: `make e2e` (Playwright) for `e2e/review.spec.ts`.

Expected: unit/lint PASS; e2e PASS if run.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/review docs/tableread-ui-spec.md
git commit -m "$(cat <<'EOF'
web: Quiet Tool Review mode chrome

Full-mode Review restyled to Quiet Tool density; Change Set flows unchanged.
EOF
)"
```

---

## Self-review (plan vs spec)

| Spec section                | Task coverage          |
| --------------------------- | ---------------------- |
| §4 Tokens                   | Task 1                 |
| §5 App shell                | Task 2                 |
| §6.1 Write                  | Task 3                 |
| §6.2 Plan                   | Task 4                 |
| §6.3 Ledger                 | Task 5                 |
| §6.4 Review (full mode)     | Task 6                 |
| Deferred modal / impact map | Explicitly out of plan |
| Sequence tokens→shell→modes | Task order 1–6         |

No TBD placeholders. `--tr-coral*` name retention called out. New tokens (`accent-ink`, `shell-height`, optional candidate dock) must stay in `EXPECTED_TOKENS` + `@theme`.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-09-quiet-tool-redesign.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks
2. **Inline Execution** — execute tasks in this session with checkpoints

Which approach?
