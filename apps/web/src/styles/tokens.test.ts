/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Read the CSS source directly (not via a Vite `?raw` import) so this test
// is unaffected by how the @tailwindcss/vite plugin transforms .css modules.
const tokensCss = readFileSync(
  fileURLToPath(new URL('./tokens.css', import.meta.url)),
  'utf-8',
)

// UI spec §1 — verbatim token names + values (docs/tableread-ui-spec.md).
// This is the enforcement point for CLAUDE.md hard rule 6: every §1 token
// must exist in tokens.css with this exact value. Do not edit this map to
// make a failing test pass — fix tokens.css, or flag the spec as wrong.
//
// The font-size/radius/shadow/motion entries come from §1's comment-only
// scales, tokenized per controller ruling on T0.4: names minted, values
// exactly as the spec comments state them. Spacing is deliberately absent —
// Tailwind's default 4px-base scale already matches the spec's spacing scale.
const EXPECTED_TOKENS: Record<string, string> = {
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
}

/**
 * The Tailwind @theme key each token must be aliased to, so utilities
 * (bg-tr-*, font-script, text-15, rounded-card, shadow-raised,
 * ease-standard, transition default duration) are backed by the --tr-
 * variables. Prefix order matters: font-size before font.
 */
function themeKeyFor(name: string): string {
  if (name === '--tr-motion-ease-standard') return '--ease-standard'
  if (name === '--tr-motion-duration-standard')
    return '--default-transition-duration'
  if (name.startsWith('--tr-font-size-'))
    return name.replace('--tr-font-size-', '--text-')
  if (name.startsWith('--tr-font-'))
    return name.replace('--tr-font-', '--font-')
  if (name.startsWith('--tr-radius-'))
    return name.replace('--tr-radius-', '--radius-')
  if (name.startsWith('--tr-shadow-'))
    return name.replace('--tr-shadow-', '--shadow-')
  return name.replace('--tr-', '--color-tr-')
}

/** Extracts `--tr-*` custom-property declarations from a `:root { ... }` block. */
function parseDeclaredTokens(css: string): Record<string, string> {
  const declarations: Record<string, string> = {}
  const pattern = /(--tr-[\w-]+)\s*:\s*([^;]+);/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(css)) !== null) {
    declarations[match[1]] = match[2].trim()
  }
  return declarations
}

describe('design tokens (UI spec §1)', () => {
  const declared = parseDeclaredTokens(tokensCss)

  it('defines every §1 token as a --tr- prefixed CSS variable', () => {
    for (const name of Object.keys(EXPECTED_TOKENS)) {
      expect(declared).toHaveProperty(name)
    }
  })

  it('matches the verbatim §1 value for every token', () => {
    for (const [name, expectedValue] of Object.entries(EXPECTED_TOKENS)) {
      expect(declared[name]).toBe(expectedValue)
    }
  })

  it('declares no --tr- token outside the §1 list (no invented tokens)', () => {
    expect(Object.keys(declared).sort()).toEqual(
      Object.keys(EXPECTED_TOKENS).sort(),
    )
  })
})

describe('Tailwind theme wiring (@theme block)', () => {
  it('aliases every token into the Tailwind theme via var(--tr-*)', () => {
    for (const name of Object.keys(EXPECTED_TOKENS)) {
      const themeKey = themeKeyFor(name)
      const pattern = new RegExp(`${themeKey}\\s*:\\s*var\\(${name}\\)\\s*;`)
      expect(tokensCss).toMatch(pattern)
    }
  })
})
