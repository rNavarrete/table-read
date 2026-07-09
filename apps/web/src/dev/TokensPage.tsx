type TokenKind = 'color' | 'font'

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
    title: 'Primary action (coral)',
    tokens: [
      { cssVar: '--tr-coral', kind: 'color' },
      { cssVar: '--tr-coral-hover', kind: 'color' },
      {
        cssVar: '--tr-coral-soft',
        description: 'selected/active tints',
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

export default function TokensPage() {
  return (
    <main className="min-h-screen bg-tr-surface-page px-8 py-10 text-tr-text-primary">
      <h1 className="font-display text-3xl">Design tokens</h1>
      <p className="mt-1 max-w-2xl text-sm text-tr-text-secondary">
        UI spec §1 — light theme only. Every swatch below renders its color or
        font from the corresponding <code>--tr-*</code> CSS variable, never a
        hardcoded value.
      </p>

      <div className="mt-8 flex flex-col gap-8">
        {TOKEN_GROUPS.map((group) => (
          <section key={group.title}>
            <h2 className="font-display text-xl">{group.title}</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.tokens.map((token) =>
                token.kind === 'font' ? (
                  <FontSample key={token.cssVar} token={token} />
                ) : (
                  <ColorSwatch key={token.cssVar} token={token} />
                ),
              )}
            </div>
          </section>
        ))}
      </div>
    </main>
  )
}
