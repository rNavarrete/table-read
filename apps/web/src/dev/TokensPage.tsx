import type { ComponentType } from 'react'

type TokenKind =
  | 'color'
  | 'font'
  | 'size'
  | 'radius'
  | 'shadow'
  | 'motion'
  | 'width'
  | 'outline'
  | 'opacity'

type TokenDef = {
  cssVar: string
  description?: string
  kind: TokenKind
}

type TokenGroup = {
  title: string
  tokens: TokenDef[]
}

// Mirrors docs/tableread-ui-spec.md §1 (light theme). Descriptions are
// transcribed verbatim from the spec's inline comments where present.
const TOKEN_GROUPS: TokenGroup[] = [
  {
    title: 'Surfaces & borders',
    tokens: [
      {
        cssVar: '--tr-surface-page',
        description: 'app background, Write mode page area',
        kind: 'color',
      },
      {
        cssVar: '--tr-surface-raised',
        description: 'cards, script canvas sheet',
        kind: 'color',
      },
      {
        cssVar: '--tr-surface-sunken',
        description: 'panels, rails, command bar',
        kind: 'color',
      },
      {
        cssVar: '--tr-surface-clay',
        description: 'frames on Plan canvas, hover fills',
        kind: 'color',
      },
      { cssVar: '--tr-border', kind: 'color' },
      { cssVar: '--tr-border-strong', kind: 'color' },
    ],
  },
  {
    title: 'Text',
    tokens: [
      { cssVar: '--tr-text-primary', kind: 'color' },
      { cssVar: '--tr-text-secondary', kind: 'color' },
      { cssVar: '--tr-text-muted', kind: 'color' },
    ],
  },
  {
    title: 'Primary action (slate accent)',
    tokens: [
      {
        cssVar: '--tr-coral',
        description: 'primary actions / accent',
        kind: 'color',
      },
      { cssVar: '--tr-coral-hover', kind: 'color' },
      {
        cssVar: '--tr-coral-soft',
        description: 'selected/active tints',
        kind: 'color',
      },
      {
        cssVar: '--tr-accent-ink',
        description: 'text on soft accent fill (selected pills)',
        kind: 'color',
      },
    ],
  },
  {
    title: 'Status hues',
    tokens: [
      {
        cssVar: '--tr-sage',
        description: 'confirmed, high-confidence, success',
        kind: 'color',
      },
      { cssVar: '--tr-sage-soft', kind: 'color' },
      {
        cssVar: '--tr-sky',
        description: 'informational, links, setup/payoff connectors',
        kind: 'color',
      },
      { cssVar: '--tr-sky-soft', kind: 'color' },
      {
        cssVar: '--tr-amber',
        description: 'needs review, speculative, pending',
        kind: 'color',
      },
      { cssVar: '--tr-amber-soft', kind: 'color' },
      {
        cssVar: '--tr-danger',
        description: 'destructive, errors only — not for AI content',
        kind: 'color',
      },
    ],
  },
  {
    title: 'Type',
    tokens: [
      { cssVar: '--tr-font-ui', kind: 'font' },
      { cssVar: '--tr-font-script', description: 'teleplay', kind: 'font' },
      {
        cssVar: '--tr-font-display',
        description: 'headings, mode titles',
        kind: 'font',
      },
      {
        cssVar: '--tr-font-ledger-display',
        description: 'Ledger story-bible titles',
        kind: 'font',
      },
    ],
  },
  {
    title: 'Type scale',
    tokens: [
      { cssVar: '--tr-font-size-11', kind: 'size' },
      { cssVar: '--tr-font-size-12', kind: 'size' },
      { cssVar: '--tr-font-size-13', kind: 'size' },
      { cssVar: '--tr-font-size-15', kind: 'size' },
      { cssVar: '--tr-font-size-17', kind: 'size' },
      { cssVar: '--tr-font-size-22', kind: 'size' },
      { cssVar: '--tr-font-size-28', kind: 'size' },
      {
        cssVar: '--tr-font-size-30',
        description: 'Ledger display title',
        kind: 'size',
      },
    ],
  },
  {
    title: 'Write redesign (script home)',
    tokens: [
      {
        cssVar: '--tr-write-desk',
        description: 'surface behind the script sheet',
        kind: 'color',
      },
      {
        cssVar: '--tr-write-panel',
        description: 'ON THE PAGE outline rail',
        kind: 'color',
      },
      {
        cssVar: '--tr-write-selected',
        description: 'active scene row in the outline',
        kind: 'color',
      },
      {
        cssVar: '--tr-write-dot-int',
        description: 'INT. slugline marker',
        kind: 'color',
      },
      {
        cssVar: '--tr-write-dot-ext',
        description: 'EXT. slugline marker',
        kind: 'color',
      },
      {
        cssVar: '--tr-write-dot-other',
        description: 'neither INT. nor EXT.',
        kind: 'color',
      },
    ],
  },
  {
    title: 'Ledger redesign',
    tokens: [
      { cssVar: '--tr-ledger-content', kind: 'color' },
      { cssVar: '--tr-ledger-selected', kind: 'color' },
      {
        cssVar: '--tr-ledger-secret-surface',
        description: 'secret card fill',
        kind: 'color',
      },
      { cssVar: '--tr-ledger-secret-border', kind: 'color' },
      { cssVar: '--tr-ledger-secret-badge', kind: 'color' },
      { cssVar: '--tr-ledger-secret-ink', kind: 'color' },
    ],
  },
  {
    title: 'Import board',
    tokens: [
      {
        cssVar: '--tr-board-paper',
        description: 'index card paper',
        kind: 'color',
      },
      { cssVar: '--tr-board-rule', description: 'card rules', kind: 'color' },
      {
        cssVar: '--tr-board-rule-top',
        description: 'card header rule',
        kind: 'color',
      },
      { cssVar: '--tr-shadow-card-board', kind: 'shadow' },
      { cssVar: '--tr-shadow-card-lift', kind: 'shadow' },
      { cssVar: '--tr-motion-spring', kind: 'motion' },
      { cssVar: '--tr-motion-settle', kind: 'motion' },
      { cssVar: '--tr-motion-deal', kind: 'motion' },
      { cssVar: '--tr-motion-flight', kind: 'motion' },
      { cssVar: '--tr-motion-string', kind: 'motion' },
      { cssVar: '--tr-card-board-w', kind: 'width' },
      { cssVar: '--tr-card-board-h', kind: 'width' },
    ],
  },
  {
    title: 'Overview panel',
    tokens: [
      { cssVar: '--tr-overview-expand-bg', kind: 'color' },
      { cssVar: '--tr-overview-icon-bg', kind: 'color' },
      { cssVar: '--tr-overview-ready-bg', kind: 'color' },
      { cssVar: '--tr-overview-ready-ink', kind: 'color' },
    ],
  },
  {
    title: 'Radius',
    tokens: [
      { cssVar: '--tr-radius-card', description: 'cards', kind: 'radius' },
      { cssVar: '--tr-radius-chip', description: 'chips', kind: 'radius' },
      {
        cssVar: '--tr-radius-frame',
        description: 'canvas frames',
        kind: 'radius',
      },
      {
        cssVar: '--tr-radius-control',
        description: 'controls',
        kind: 'radius',
      },
      {
        cssVar: '--tr-radius-ledger-card',
        description: 'Ledger cards',
        kind: 'radius',
      },
    ],
  },
  {
    title: 'Shadow',
    tokens: [
      { cssVar: '--tr-shadow-raised', description: 'standard', kind: 'shadow' },
      {
        cssVar: '--tr-shadow-lift',
        description: 'lift on drag',
        kind: 'shadow',
      },
      {
        cssVar: '--tr-shadow-write-page',
        description: 'script sheet',
        kind: 'shadow',
      },
      {
        cssVar: '--tr-shadow-write-card',
        description: 'candidate card',
        kind: 'shadow',
      },
      {
        cssVar: '--tr-shadow-write-bar',
        description: 'floating command bar',
        kind: 'shadow',
      },
      {
        cssVar: '--tr-shadow-write-cta',
        description: 'primary action',
        kind: 'shadow',
      },
      {
        cssVar: '--tr-shadow-ledger-card',
        description: 'Ledger card',
        kind: 'shadow',
      },
      {
        cssVar: '--tr-shadow-overview-card',
        description: 'Overview card',
        kind: 'shadow',
      },
    ],
  },
  {
    title: 'Motion',
    tokens: [
      {
        cssVar: '--tr-motion-duration-standard',
        description: 'standard duration; streaming text has no animation',
        kind: 'motion',
      },
      {
        cssVar: '--tr-motion-ease-standard',
        description: 'standard easing',
        kind: 'motion',
      },
    ],
  },
  {
    title: 'Layout',
    tokens: [
      {
        cssVar: '--tr-script-col',
        description: 'script column / command bar max-width (UI spec §3)',
        kind: 'width',
      },
      {
        cssVar: '--tr-panel-candidate-dock',
        description: 'Write mode CO-WRITER dock width (UI spec §3)',
        kind: 'width',
      },
      {
        cssVar: '--tr-panel-write-outline',
        description: 'Write mode ON THE PAGE outline width (UI spec §3)',
        kind: 'width',
      },
      {
        cssVar: '--tr-script-page',
        description: 'Write mode script sheet max-width (UI spec §3)',
        kind: 'width',
      },
      {
        cssVar: '--tr-command-bar',
        description: 'Write mode floating command bar width (UI spec §3)',
        kind: 'width',
      },
      {
        cssVar: '--tr-panel-story-layers',
        description: 'Plan mode Story Layers panel width (UI spec §4)',
        kind: 'width',
      },
      {
        cssVar: '--tr-panel-inspector',
        description: 'Plan mode inspector width (UI spec §4)',
        kind: 'width',
      },
      {
        cssVar: '--tr-panel-ledger-filters',
        description: 'Ledger mode filter rail width (UI spec §6)',
        kind: 'width',
      },
      {
        cssVar: '--tr-card-scene',
        description: 'Plan mode scene card width (UI spec §4)',
        kind: 'width',
      },
      {
        cssVar: '--tr-shell-height',
        description: 'app shell top bar height (UI spec §2)',
        kind: 'width',
      },
    ],
  },
  {
    title: 'Outline',
    tokens: [
      {
        cssVar: '--tr-outline-selected',
        description: 'selected scene-card outline width (UI spec §4)',
        kind: 'outline',
      },
    ],
  },
  {
    title: 'Opacity',
    tokens: [
      {
        cssVar: '--tr-opacity-locked',
        description: 'locked Change Set rows (UI spec §5)',
        kind: 'opacity',
      },
    ],
  },
]

// Reads the value straight off the cascade — never hardcoded here — so this
// page also doubles as a runtime check that each variable actually resolves.
function resolvedValue(cssVar: string): string {
  if (typeof window === 'undefined') return ''
  return getComputedStyle(document.documentElement)
    .getPropertyValue(cssVar)
    .trim()
}

function TokenMeta({ token }: { token: TokenDef }) {
  return (
    <>
      <code className="text-sm text-tr-text-primary">{token.cssVar}</code>
      <span className="text-xs text-tr-text-muted">
        {resolvedValue(token.cssVar)}
      </span>
      {token.description && (
        <span className="text-xs text-tr-text-secondary">
          {token.description}
        </span>
      )}
    </>
  )
}

function ColorSwatch({ token }: { token: TokenDef }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-tr-border bg-tr-surface-raised p-3">
      <div
        className="h-12 w-12 shrink-0 rounded-lg border border-tr-border-strong"
        style={{ background: `var(${token.cssVar})` }}
      />
      <div className="flex min-w-0 flex-col">
        <TokenMeta token={token} />
      </div>
    </div>
  )
}

function FontSample({ token }: { token: TokenDef }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-tr-border bg-tr-surface-raised p-3">
      <p
        className="text-lg text-tr-text-primary"
        style={{ fontFamily: `var(${token.cssVar})` }}
      >
        The quick brown fox jumps.
      </p>
      <TokenMeta token={token} />
    </div>
  )
}

function SizeSample({ token }: { token: TokenDef }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-tr-border bg-tr-surface-raised p-3">
      <p
        className="text-tr-text-primary"
        style={{ fontSize: `var(${token.cssVar})` }}
      >
        The quick brown fox jumps.
      </p>
      <TokenMeta token={token} />
    </div>
  )
}

function RadiusSample({ token }: { token: TokenDef }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-tr-border bg-tr-surface-raised p-3">
      <div
        className="h-12 w-12 shrink-0 border border-tr-border-strong bg-tr-surface-clay"
        style={{ borderRadius: `var(${token.cssVar})` }}
      />
      <div className="flex min-w-0 flex-col">
        <TokenMeta token={token} />
      </div>
    </div>
  )
}

function ShadowSample({ token }: { token: TokenDef }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-tr-border bg-tr-surface-raised p-3">
      <div
        className="h-12 w-12 shrink-0 rounded-lg bg-tr-surface-raised"
        style={{ boxShadow: `var(${token.cssVar})` }}
      />
      <div className="flex min-w-0 flex-col">
        <TokenMeta token={token} />
      </div>
    </div>
  )
}

function MotionRow({ token }: { token: TokenDef }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-tr-border bg-tr-surface-raised p-3">
      <TokenMeta token={token} />
    </div>
  )
}

function WidthSample({ token }: { token: TokenDef }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-tr-border bg-tr-surface-raised p-3">
      <div
        className="h-2 w-full rounded-lg bg-tr-surface-clay"
        style={{ maxWidth: `var(${token.cssVar})` }}
      />
      <div className="flex min-w-0 flex-col">
        <TokenMeta token={token} />
      </div>
    </div>
  )
}

function OutlineSample({ token }: { token: TokenDef }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-tr-border bg-tr-surface-raised p-3">
      <div
        className="h-12 w-12 shrink-0 rounded-lg bg-tr-surface-clay outline outline-tr-coral"
        style={{ outlineWidth: `var(${token.cssVar})` }}
      />
      <div className="flex min-w-0 flex-col">
        <TokenMeta token={token} />
      </div>
    </div>
  )
}

function OpacitySample({ token }: { token: TokenDef }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-tr-border bg-tr-surface-raised p-3">
      <div
        className="h-12 w-12 shrink-0 rounded-lg border border-tr-border-strong bg-tr-coral"
        style={{ opacity: `var(${token.cssVar})` }}
      />
      <div className="flex min-w-0 flex-col">
        <TokenMeta token={token} />
      </div>
    </div>
  )
}

const SAMPLE_FOR_KIND: Record<TokenKind, ComponentType<{ token: TokenDef }>> = {
  color: ColorSwatch,
  font: FontSample,
  size: SizeSample,
  radius: RadiusSample,
  shadow: ShadowSample,
  motion: MotionRow,
  width: WidthSample,
  outline: OutlineSample,
  opacity: OpacitySample,
}

export default function TokensPage() {
  return (
    <main className="min-h-screen bg-tr-surface-page px-8 py-10 text-tr-text-primary">
      <h1 className="font-display text-3xl">Design tokens</h1>
      <p className="mt-1 max-w-2xl text-sm text-tr-text-secondary">
        UI spec §1 — light theme only. Every sample below renders its value
        (color, font, size, radius, shadow, motion) from the corresponding{' '}
        <code>--tr-*</code> CSS variable, never a hardcoded value. Spacing has
        no tokens: Tailwind&apos;s default 4px-base scale matches spec §1.
      </p>

      <div className="mt-8 flex flex-col gap-8">
        {TOKEN_GROUPS.map((group) => (
          <section key={group.title}>
            <h2 className="font-display text-xl">{group.title}</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.tokens.map((token) => {
                const Sample = SAMPLE_FOR_KIND[token.kind]
                return <Sample key={token.cssVar} token={token} />
              })}
            </div>
          </section>
        ))}
      </div>
    </main>
  )
}
