import { wordDiff } from './wordDiff'

export type DiffPaneVariant = 'plan' | 'script'

/**
 * Before/after panes (UI spec §5 / §7 DiffPane). Plan variant: word-level
 * diff. Script variant: script-font block — when both sides exist, show
 * before struck + after; when `after` is null, ghost "Preview to generate".
 */
export function DiffPane({
  before,
  after,
  variant,
  previewing = false,
}: {
  before: string
  after: string | null
  variant: DiffPaneVariant
  /** Shimmer the after pane while preview is in flight (UI spec §5). */
  previewing?: boolean
}) {
  const scriptClass = variant === 'script' ? ' font-script text-12' : ' text-13'

  return (
    <div className="grid grid-cols-2 gap-3">
      <div
        className={`rounded-card border border-tr-border bg-tr-surface-sunken p-3${scriptClass}`}
        data-testid="diff-before"
      >
        <p className="mb-1 text-12 uppercase tracking-wide text-tr-text-muted">
          Before
        </p>
        {variant === 'plan' && after !== null ? (
          <PlanDiff before={before} after={after} side="before" />
        ) : (
          <p className="whitespace-pre-wrap text-tr-text-secondary">
            {before || '—'}
          </p>
        )}
      </div>
      <div
        className={
          `rounded-card border border-tr-border bg-tr-surface-raised p-3${scriptClass}` +
          (previewing ? ' animate-pulse' : '')
        }
        data-testid="diff-after"
        aria-busy={previewing || undefined}
      >
        <p className="mb-1 text-12 uppercase tracking-wide text-tr-text-muted">
          After
        </p>
        {after === null ? (
          <p className="text-tr-text-muted italic">Preview to generate</p>
        ) : variant === 'plan' ? (
          <PlanDiff before={before} after={after} side="after" />
        ) : (
          <p className="whitespace-pre-wrap text-tr-text-primary">{after}</p>
        )}
      </div>
    </div>
  )
}

function PlanDiff({
  before,
  after,
  side,
}: {
  before: string
  after: string
  side: 'before' | 'after'
}) {
  const tokens = wordDiff(before, after)
  return (
    <p
      className="whitespace-pre-wrap text-tr-text-primary"
      data-testid="word-diff"
    >
      {tokens.map((token, index) => {
        if (token.kind === 'equal') {
          return <span key={index}>{token.text}</span>
        }
        if (token.kind === 'del') {
          if (side === 'after') return null
          return (
            <del key={index} className="text-tr-text-muted line-through">
              {token.text}
            </del>
          )
        }
        if (side === 'before') return null
        return (
          <ins
            key={index}
            className="text-tr-sage underline decoration-tr-sage"
          >
            {token.text}
          </ins>
        )
      })}
    </p>
  )
}
