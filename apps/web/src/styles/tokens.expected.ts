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

  '--tr-font-size-11': '11px',
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
  '--tr-panel-candidate-dock': '332px',
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
