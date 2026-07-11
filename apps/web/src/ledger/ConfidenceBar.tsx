/**
 * `ConfidenceBar` — §7 inventory. Quiet Tool's Ledger bar uses sage fill on
 * cool paper; superseded facts can mute the fill while retaining the meter.
 */
export function ConfidenceBar({
  confidence,
  muted = false,
}: {
  confidence: number
  muted?: boolean
}) {
  return (
    <div
      className="h-0.5 w-full overflow-hidden rounded-chip bg-tr-surface-sunken"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={confidence}
      aria-label={`Confidence ${Math.round(confidence * 100)} percent`}
      data-testid="confidence-bar"
    >
      <div
        className={
          'h-full transition-[width] duration-standard ease-standard motion-reduce:transition-none ' +
          (muted ? 'bg-tr-text-muted' : 'bg-tr-sage')
        }
        data-testid="confidence-bar-fill"
        style={{ width: `${Math.round(confidence * 100)}%` }}
      />
    </div>
  )
}
