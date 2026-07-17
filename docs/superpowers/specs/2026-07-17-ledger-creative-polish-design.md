# Ledger creative polish — design note

**Date:** 2026-07-17  
**Status:** shipping with this PR  
**Base:** `1b8928f` (browse-clarity + zero-count People fold)  
**Scope:** Ledger mode chrome only (FilterRail, Story Atlas, Knowledge Web hybrid, FactCard, LedgerScreen header/queue, LedgerViewSwitcher) + shared primitives already used there (`Card`, `Chip`).

## Intent

Functionally Ledger is “much better.” This pass makes it feel **slick, considered, clean, and delightful** for writers who care about craft — without inventing new taxonomies, graph libraries, or breaking as-of / People / browse-clarity behavior.

Preserve **Quiet Tool**: cool paper, slate-blue accent, Instrument Sans, soft ambient shadows. Elevate craft; do not restyle the whole app.

## Anti-goals

- New graph libraries or layout experiments beyond the current hybrid Web
- New fact taxonomies / cue systems
- Breaking as-of, People fold, browse counts, or review mutations
- AI-slop aesthetics (purple gradients, cream+terracotta cliché, broadsheet hairlines-only, dark-mode default, emoji, glow, pill spam, multi-layer shadows)
- Rip-and-replace of Write / Plan / Review

## Approaches considered

| Approach | Idea | Trade-off |
|---|---|---|
| A. Token overhaul | Retune global Quiet Tool colors/radii for Ledger | Touches whole app; out of scope |
| B. Editorial Quiet Tool (chosen) | Hierarchy, density, focus, empty states, 2–3 subtle motions — tokens unchanged unless a real gap | High craft, low risk |
| C. Decorative “writer studio” | Illustration panels, heavy gradients | Violates Quiet Tool + anti-goals |

**Recommendation: B.** Same brand DNA; Atlas/Web read as a story bible, not an admin table.

## Direction that ships

### Surfaces & density
- Atlas / Web rows: raised white sheets with `--tr-shadow-raised` at rest, `--tr-shadow-lift` on hover/selected — hairline border stays, but shadow carries depth.
- Expanded Atlas row + selected Web row: `--tr-outline-selected` slate-blue outline + lift (same selection language as Plan cards).
- Filter rail: keep sunken Quiet Tool panel; options get clearer active fill + hover; As-of select sits on raised surface with focus ring.
- Review queue: amber-soft section with a left accent edge (status meaning) instead of feeling like a warning dump; cards remain raised FactCards.

### Typography & rhythm
- Page title stays display 22px; chapter titles step up to display 17px primary (secondary was too admin).
- Collapsed Atlas fact text stays 15px; Web list fact text matches 15px (was 13 — felt like a data grid).
- Section legends (People / Browse / …): 11–12px uppercase muted with slightly wider tracking; counts stay muted parentheses.
- Empty states: short display-line + secondary support copy in a quiet raised/clay panel — writer tool, not “No results.”

### Motion (presence, not noise)
All use `--tr-motion-duration-standard` + `--tr-motion-ease-standard`; honor `prefers-reduced-motion`.

1. **Selection** — Atlas expand / Web row select: outline + shadow transition.
2. **Section expand** — Status / zero-count People disclosures: color/background ease on summary + options.
3. **View switch** — Atlas ↔ Web body: brief fade/rise enter (`tr-ledger-view-enter` in `index.css`, token durations only).

### Focus & chrome
- Interactive rows/options: consistent `focus-visible` outline (`outline-selected` + `--tr-coral`).
- View switcher: match ModeSwitcher segment language (clay track, coral-soft active, hover raised) with duration-standard color transitions.
- Pending chip: amber-soft pill with hover lift, keyboard-focusable.

### What does not change
- Filter model, chapter taxonomy, knower cues, hybrid Web ranking/cap/overflow, as-of semantics, People zero-count fold behavior, mutation/snapshot paths.

## Verification (Number_Two)

Atlas + Web on Number_Two: see screenshot checklist in the PR / handoff — selection lift, chapter hierarchy, Web focus strip calmness, empty/filtered states, view-switch fade, FilterRail People fold still collapses zeros.
