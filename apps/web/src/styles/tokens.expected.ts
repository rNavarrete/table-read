// Single expected-token list shared by the token tests (tokens.test.ts checks
// tokens.css declares each one; TokensPage.test.tsx checks /tokens renders
// each one). Do not copy this map — import it.
//
// UI spec §1 — verbatim token names + values (docs/tableread-ui-spec.md).
// This is the enforcement point for CLAUDE.md hard rule 6: every §1 token
// must exist in tokens.css with this exact value. Do not edit this map to
// make a failing test pass — fix tokens.css, or flag the spec as wrong.
//
// The font-size/radius/shadow/motion entries come from §1's comment-only
// scales, tokenized per controller ruling on T0.4: names minted, values
// exactly as the spec comments state them. Spacing is deliberately absent —
// Tailwind's default 4px-base scale already matches the spec's spacing scale.
export const EXPECTED_TOKENS: Record<string, string> = {
  '--tr-surface-page': '#FAF6EF',
  '--tr-surface-raised': '#FFFDF8',
  '--tr-surface-sunken': '#F1EAE0',
  '--tr-surface-clay': '#E8DCCB',
  '--tr-border': '#DDD2C2',
  '--tr-border-strong': '#C4B6A1',

  '--tr-text-primary': '#2B2724',
  '--tr-text-secondary': '#6B615A',
  '--tr-text-muted': '#988D83',

  '--tr-coral': '#E0704F',
  '--tr-coral-hover': '#C95E3F',
  '--tr-coral-soft': '#F7DED4',

  '--tr-sage': '#7E9B76',
  '--tr-sage-soft': '#E4ECE0',
  '--tr-sky': '#6E93B8',
  '--tr-sky-soft': '#E1EAF2',
  '--tr-amber': '#C9913B',
  '--tr-amber-soft': '#F5E8D2',
  '--tr-danger': '#B0503C',

  '--tr-font-ui': '"Inter", system-ui, sans-serif',
  '--tr-font-script': '"Courier Prime", "Courier New", monospace',
  '--tr-font-display': '"Fraunces", Georgia, serif',

  '--tr-font-size-12': '12px',
  '--tr-font-size-13': '13px',
  '--tr-font-size-15': '15px',
  '--tr-font-size-17': '17px',
  '--tr-font-size-22': '22px',
  '--tr-font-size-28': '28px',

  '--tr-radius-card': '10px',
  '--tr-radius-chip': '999px',
  '--tr-radius-frame': '14px',

  '--tr-shadow-raised': '0 1px 3px rgb(43 39 36 / 0.08)',
  '--tr-shadow-lift': '0 8px 24px rgb(43 39 36 / 0.14)',

  '--tr-motion-duration-standard': '160ms',
  '--tr-motion-ease-standard': 'ease-out',

  // Layout: UI spec §3's literal 720px script-column / command-bar width,
  // tokenized per controller ruling on T2.3 review.
  '--tr-script-col': '720px',

  // Layout: UI spec §4 Plan-mode board panel/card widths, tokenized per
  // controller ruling on T3.1 (same "mint for spec-stated pixel values
  // lacking a token name" precedent as --tr-script-col above).
  '--tr-panel-story-layers': '240px',
  '--tr-panel-inspector': '300px',
  '--tr-card-scene': '260px',

  // Layout: UI spec §6 Ledger filter rail (200px), same mint precedent.
  '--tr-panel-ledger-filters': '200px',

  // §4 "Selected = 2px coral outline" — width only (color is --tr-coral).
  '--tr-outline-selected': '2px',

  // §5 locked Change Set rows at 55% opacity — value from the spec text.
  '--tr-opacity-locked': '0.55',
}
