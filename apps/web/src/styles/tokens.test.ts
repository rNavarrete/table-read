/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { EXPECTED_TOKENS } from './tokens.expected'

// Read the CSS source directly (not via a Vite `?raw` import) so this test
// is unaffected by how the @tailwindcss/vite plugin transforms .css modules.
const tokensCss = readFileSync(
  fileURLToPath(new URL('./tokens.css', import.meta.url)),
  'utf-8',
)

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
  // Import board motion: easings back ease-* utilities; durations sit under
  // --duration-* for the board's Web Animations.
  if (name === '--tr-motion-spring' || name === '--tr-motion-settle')
    return name.replace('--tr-motion-', '--ease-')
  if (name.startsWith('--tr-motion-'))
    return name.replace('--tr-motion-', '--duration-')
  // Tailwind v4's --container-* namespace backs max-w-* utilities. The Write
  // redesign's script sheet and command bar are max-widths too, not colors —
  // without these the fallthrough would demand a --color-tr-* alias.
  if (name === '--tr-script-col') return '--container-script-col'
  if (name === '--tr-script-page') return '--container-script-page'
  if (name === '--tr-command-bar') return '--container-command-bar'
  // Tailwind v4's --spacing-* namespace backs w-*/h-*/p-*/m-*/gap-* etc. for
  // named values (verified empirically — see tokens.css's comment).
  if (name === '--tr-shell-height') return '--spacing-shell-height'
  if (name.startsWith('--tr-panel-') || name.startsWith('--tr-card-'))
    return name.replace('--tr-', '--spacing-')
  // Tailwind v4's --outline-width-* namespace backs outline-<name>.
  if (name.startsWith('--tr-outline-'))
    return name.replace('--tr-outline-', '--outline-width-')
  // Tailwind v4's --opacity-* namespace backs opacity-<name>.
  if (name.startsWith('--tr-opacity-'))
    return name.replace('--tr-opacity-', '--opacity-')
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

describe('design tokens (UI spec §1 + minted scales)', () => {
  const declared = parseDeclaredTokens(tokensCss)

  it('defines every expected token as a --tr- prefixed CSS variable', () => {
    for (const name of Object.keys(EXPECTED_TOKENS)) {
      expect(declared).toHaveProperty(name)
    }
  })

  it('matches the expected value verbatim for every token', () => {
    for (const [name, expectedValue] of Object.entries(EXPECTED_TOKENS)) {
      expect(declared[name]).toBe(expectedValue)
    }
  })

  it('declares no --tr- token outside the expected list (no invented tokens)', () => {
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
