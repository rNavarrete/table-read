/**
 * `ConfidenceBar` — §7 inventory. 2px bar: sage ≥0.8 / amber below
 * (UI spec §6). Color alone is never the only signal — callers also show
 * a numeric/text label when meaning matters; here the bar is decorative
 * beside the provenance/status chips.
 */
export function ConfidenceBar({ confidence }: { confidence: number }) {
  const high = confidence >= 0.8
  return (
    <div
      className="h-0.5 w-full overflow-hidden rounded-chip bg-tr-surface-clay"
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
          (high ? 'bg-tr-sage' : 'bg-tr-amber')
        }
        style={{ width: `${Math.round(confidence * 100)}%` }}
      />
    </div>
  )
}
