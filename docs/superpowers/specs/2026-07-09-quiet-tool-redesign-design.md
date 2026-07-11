# Quiet Tool visual redesign — design spec

**Date:** 2026-07-09  
**Status:** draft for review  
**Source:** `design_handoff_quiet_tool/` (README + HTML reference)  
**Authority after merge:** this spec updates `docs/tableread-ui-spec.md`; product behavior remains governed by `docs/narrative-sidekick-design-doc.md` and `packages/contract`.

## 1. Goal

Recreate the **Quiet Tool** look and feel across the whole Table Read web app — cool neutrals, slate-blue accent, Instrument Sans, soft shadows — using existing React components and `--tr-*` tokens. **Do not copy the handoff HTML.**

Redesign **everything** visually. **Do not change** product logic, API contracts, or Review-as-a-full-mode architecture.

## 2. Decisions (locked)

| Decision | Choice |
|---|---|
| Product authority for visuals | Quiet Tool **replaces** the current warm-ivory / coral / Fraunces UI language in `tableread-ui-spec.md` |
| Review interaction | **Keep what we built** — Review stays a full mode (`/review`), with draft/`previewing` list, preview/apply/flag/discard, Undo all after apply |
| Handoff Review modal over Plan | **Out of scope** for this redesign (visual language only). Impact-map radial diagram also deferred |
| Rollout order | Tokens → shell → Write → Plan → Ledger → Review (least error-prone; full redesign, sequenced) |
| Accent | Slate-blue `#5B79A6` / hover `#4A6690` (handoff default). No alternate accent switcher in MVP |

## 3. Non-goals

- Turning Review into a Plan-scrim modal
- Story impact map (radial diagram)
- New API endpoints or Change Set semantics
- Dark theme
- Copying Graywater sample content (keep fixture / live data)
- Renaming `--tr-coral*` tokens (values change to slate-blue; names stay to avoid a mass class rename)

## 4. Tokens

Keep existing `--tr-*` **names**. Update **values** in `apps/web/src/styles/tokens.css` and mirror in `docs/tableread-ui-spec.md` §1. Components continue to use tokens only (CLAUDE.md hard rule 6).

### 4.1 Color remapping

| Token | New value | Role |
|---|---|---|
| `--tr-surface-page` | `#F6F6F3` | App background |
| `--tr-surface-raised` | `#FFFFFF` | Cards, script sheet |
| `--tr-surface-sunken` | `#F0F0EC` | Top bar, rails, board wrappers |
| `--tr-surface-clay` | `#EBEBE6` | Mode-switcher track, act frames, hover fills |
| `--tr-border` | `#E8E8E2` | Hairline borders |
| `--tr-border-strong` | `#D9D9D2` | Stronger outlines (buttons, focus-adjacent) |
| `--tr-text-primary` | `#26272B` | Body / titles |
| `--tr-text-secondary` | `#84857D` | Secondary |
| `--tr-text-muted` | `#9a9b92` | Hints / placeholders |
| `--tr-coral` | `#5B79A6` | Primary actions / accent (name retained) |
| `--tr-coral-hover` | `#4A6690` | Accent hover |
| `--tr-coral-soft` | `#DEE5EE` | Selected nav / soft accent fill |
| `--tr-sage` | `#7D9678` | Confirmed / high confidence |
| `--tr-sage-soft` | `#E7EEE4` | Sage chip bg |
| `--tr-sky` | `#41608A` | Info / flag-only / links |
| `--tr-sky-soft` | `#E4EBF2` | Sky chip bg |
| `--tr-amber` | `#8A6120` | Pending / speculative text |
| `--tr-amber-soft` | `#FBF4E6` | Amber banner / chip bg (border `#EAD9B8` where needed) |
| `--tr-danger` | keep destructive role; retune if needed for contrast on cool paper (prefer existing `#B0503C` unless illegible) | Errors only |

**Selected text on soft accent:** when using `--tr-coral-soft` as a selected pill background, text should read as `#33445E` (add `--tr-accent-ink` **or** document that selected segments use `text-tr-text-primary` with sufficient contrast — prefer a new token `--tr-accent-ink: #33445E` if contrast fails WCAG on soft fill).

### 4.2 Typography

| Token | New value |
|---|---|
| `--tr-font-ui` | `"Instrument Sans", system-ui, sans-serif` |
| `--tr-font-display` | same as UI (drop Fraunces) |
| `--tr-font-script` | `"Courier Prime", "Courier New", monospace` (unchanged) |

Load Instrument Sans + Courier Prime (Google Fonts or self-hosted — match existing font-loading pattern in the web app).

Font-size scale: keep 12/13/15/17/22/28; Quiet Tool’s 10–11px uppercase section labels may use `text-12` + tracking utilities rather than inventing a new size unless the TokensPage / UI spec needs an explicit `--tr-font-size-11`.

### 4.3 Radius, shadow, motion, layout widths

| Token | New / keep |
|---|---|
| `--tr-radius-card` | `10px` → `12px` (Quiet Tool 8–12; pick 12 for cards) |
| `--tr-radius-chip` | `999px` (keep) |
| `--tr-radius-frame` | `12px` (was 14) |
| `--tr-shadow-raised` | soft ambient; prefer near-invisible at rest |
| `--tr-shadow-lift` | `0 4px 16px rgb(38 39 43 / 0.08)` (card hover) |
| Motion | keep 160ms ease-out |
| `--tr-script-col` | ~600px sheet width per handoff (was 720) — update if Write layout adopts 600 |
| `--tr-panel-story-layers` | `232px` |
| `--tr-panel-inspector` | `296px` |
| `--tr-card-scene` | `214px` |
| `--tr-panel-ledger-filters` | `198px` |

Modal scrim (if any future overlay): `rgb(38 39 43 / 0.34)` + `backdrop-filter: blur(2px)` — not required for this pass.

## 5. App shell

**Behavior unchanged:** project title, mode switcher (Write · Plan · Review · Ledger), Undo / Export / Settings, ⌘1–4, Review amber dot when open Change Set exists, Ledger amber count when `pending_review` > 0, Settings privacy copy.

**Visual:**
- Top bar height **52px** (tokenize if needed, e.g. `--tr-shell-height: 52px`)
- Bar background `--tr-surface-sunken`
- Mode switcher on clay track; **active** segment uses `--tr-coral-soft` + accent ink (not old coral-soft-on-warm)
- Title: Instrument Sans, ~17px / 600, primary text
- Utility actions: muted text links

## 6. Modes (visual only)

### 6.1 Write

Keep: script canvas + candidate dock + command bar; quiet-AI dimming; Accept / Tune / Skip; Next Beat empty state; SSE streaming.

Restyle:
- Script sheet white card, Courier Prime, handoff-like slug/character/dialogue density (indents via existing ScriptCanvas structure — adjust CSS, don’t invent a second parser)
- Dock ~332px; candidate cards white, 12px radius, hairline border; Accept = solid accent; Tune = outlined; Skip = text ~60% opacity
- Command bar floating pill, placeholder “Tell the scene where to go…”

### 6.2 Plan

Keep: Story Layers · Board · Inspector; Open Review / Save field only; locks; reorder; consistency flag dots on scenes.

Restyle:
- Panel widths per §4.3
- Act frames on sunken/clay; scene cards 214px; selected = soft accent fill or 2px accent outline (prefer soft fill to match handoff “tsel” pills)
- Lock control as pill switch (existing LockToggle restyled)

### 6.3 Ledger

Keep: filter rail, review queue, batch accept, fact cards, confirm/edit/reject, confidence bar, superseded strike.

Restyle:
- Rail ~198px; accent-tint active filter
- Amber awaiting-review banner; Accept all high-confidence
- 2-column fact grid; status/type chips; known-by initial chips; sage confidence bar

### 6.4 Review

Keep: `/review` route; list `draft,previewing`; single auto-open; ChangeSetPanel preview/apply/flag/discard; locked / flag_only rows; post-apply Undo all; continuity / post-apply flags.

Restyle:
- Quieter header (instruction + target chip + status)
- Row density closer to handoff table: checkbox · element · lock · reason · confidence · before→after chips (adapt `ChangeSetRow` / `DiffPane` — no new API fields)
- Footer: Preview / Apply (accent) / Flag only / Discard; reassurance line optional (“Nothing changes until you confirm”) where it doesn’t contradict preview-then-apply

**Explicitly deferred:** Plan-scrim modal shell; radial impact map.

## 7. Implementation sequence

1. **Tokens + fonts + UI spec §1** — `tokens.css`, font load, `TokensPage` / token tests, `tableread-ui-spec.md`
2. **App shell** — `AppShell`, `ModeSwitcher`
3. **Write** — ScriptCanvas, CandidateCard/Dock, CommandBar
4. **Plan** — Board, SceneCard, StoryLayers, Inspector, Chip, LockToggle, Card
5. **Ledger** — FilterRail, FactCard, LedgerScreen queue
6. **Review** — ChangeSetPanel, ChangeSetRow, DiffPane, ReviewScreen picker chrome

Each step: visual + lint + existing unit/e2e still green. No behavior changes in the same PR as a pure reskin when avoidable.

## 8. Doc updates required

- `docs/tableread-ui-spec.md` — replace §1 tokens and adjust §2–§6 chrome descriptions to Quiet Tool (Review remains a mode, not a modal)
- This file remains the redesign decision record; UI spec becomes day-to-day authority after update

## 9. Success criteria

- App reads as Quiet Tool (cool paper, slate accent, Instrument Sans) in all four modes + shell
- No hardcoded hex/spacing in components (tokens only)
- Review still works as today’s full mode (create from Plan → review → preview → apply)
- `make lint` / `make test` / relevant e2e still pass
- Handoff HTML is reference only — not imported into the repo as a runtime asset

## 10. Open follow-ups (not this redesign)

- Review-as-modal-over-Plan (handoff interaction)
- Story impact map
- Accent theme switcher (sage / clay alts from handoff props)
