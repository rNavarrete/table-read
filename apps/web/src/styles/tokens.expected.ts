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
  '--tr-font-ledger-display': '"Newsreader", "Instrument Sans", Georgia, serif',

  '--tr-font-size-11': '11px',
  '--tr-font-size-12': '12px',
  '--tr-font-size-13': '13px',
  '--tr-font-size-15': '15px',
  '--tr-font-size-17': '17px',
  '--tr-font-size-22': '22px',
  '--tr-font-size-28': '28px',
  '--tr-font-size-30': '30px',

  // Write redesign (T2.4 script home) — desk, paper sheet, slugline dots
  '--tr-write-desk': '#F1EEEA',
  '--tr-write-panel': '#F7F5F2',
  '--tr-write-selected': '#E6EBF5',
  '--tr-write-dot-int': '#6F93D6',
  '--tr-write-dot-ext': '#4FA877',
  '--tr-write-dot-other': '#C4C0B8',

  // Ledger redesign — story-bible surfaces + secret/concealment accents
  '--tr-ledger-content': '#F3F1EE',
  '--tr-ledger-selected': '#E8E4DF',
  '--tr-ledger-secret-surface': '#F8F2E8',
  '--tr-ledger-secret-border': '#E9DCC6',
  '--tr-ledger-secret-badge': '#F0E2C8',
  '--tr-ledger-secret-ink': '#9A6B2F',

  // Import board (§2a) — card paper, rules, shadows, motion, card sizes
  '--tr-board-paper': '#FFFEFB',
  '--tr-board-rule': 'rgb(65 96 138 / 0.1)',
  '--tr-board-rule-top': 'rgb(91 121 166 / 0.55)',
  '--tr-shadow-card-board':
    '0 1px 1px rgb(38 39 43 / 0.05), 0 3px 8px rgb(38 39 43 / 0.06)',
  '--tr-shadow-card-lift':
    '0 2px 4px rgb(38 39 43 / 0.06), 0 16px 32px rgb(38 39 43 / 0.16)',
  '--tr-motion-spring': 'cubic-bezier(.34,1.42,.64,1)',
  '--tr-motion-settle': 'cubic-bezier(.2,0,0,1)',
  '--tr-motion-deal': '620ms',
  '--tr-motion-flight': '760ms',
  '--tr-motion-string': '700ms',
  '--tr-card-board-w': '150px',
  '--tr-card-board-h': '106px',

  // Overview panel accents
  '--tr-overview-expand-bg': '#F6F4F1',
  '--tr-overview-icon-bg': '#E6EBF5',
  '--tr-overview-ready-bg': '#E8F5EC',
  '--tr-overview-ready-ink': '#3D8A5A',

  '--tr-radius-card': '12px',
  '--tr-radius-chip': '999px',
  '--tr-radius-frame': '12px',
  '--tr-radius-control': '9px',
  '--tr-radius-ledger-card': '15px',

  '--tr-shadow-raised': '0 1px 2px rgb(38 39 43 / 0.04)',
  '--tr-shadow-lift': '0 4px 16px rgb(38 39 43 / 0.08)',
  '--tr-shadow-write-page': '0 30px 70px -44px rgb(38 39 43 / 0.35)',
  '--tr-shadow-write-card': '0 16px 40px -28px rgb(38 39 43 / 0.35)',
  '--tr-shadow-write-bar': '0 20px 50px -24px rgb(38 39 43 / 0.4)',
  '--tr-shadow-write-cta': '0 8px 20px -12px rgb(91 121 166 / 0.55)',
  '--tr-shadow-ledger-card': '0 12px 30px -18px rgb(38 39 43 / 0.28)',
  '--tr-shadow-overview-card': '0 12px 34px -26px rgb(38 39 43 / 0.35)',

  '--tr-motion-duration-standard': '160ms',
  '--tr-motion-ease-standard': 'ease-out',

  '--tr-script-col': '600px',
  '--tr-panel-candidate-dock': '392px',
  '--tr-panel-write-outline': '296px',
  '--tr-command-bar': '560px',
  '--tr-script-page': '680px',
  '--tr-panel-story-layers': '232px',
  '--tr-panel-inspector': '296px',
  '--tr-card-scene': '214px',
  '--tr-panel-plan': '400px',
  '--tr-panel-ledger-filters': '236px',

  '--tr-outline-selected': '2px',
  '--tr-opacity-locked': '0.55',

  // Quiet Tool selected-pill ink + shell height
  '--tr-accent-ink': '#33445E',
  '--tr-shell-height': '56px',
}
