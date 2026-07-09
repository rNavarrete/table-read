import type { ReactNode } from 'react'

export type ChipHue = 'sage' | 'sky' | 'amber' | 'neutral'

const HUE_CLASSES: Record<ChipHue, string> = {
  sage: 'bg-tr-sage-soft text-tr-text-primary',
  sky: 'bg-tr-sky-soft text-tr-text-primary',
  amber: 'bg-tr-amber-soft text-tr-text-primary',
  neutral: 'bg-tr-surface-clay text-tr-text-secondary',
}

/**
 * `Chip` — §7's component inventory. Status-hue pill (UI spec §1: "status
 * meaning doubled with text/icon (never color alone)" — callers pass an
 * icon/glyph as a child alongside the label text, this component never
 * conveys meaning by color alone).
 */
export function Chip({
  hue = 'neutral',
  children,
}: {
  hue?: ChipHue
  children: ReactNode
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-chip px-2 py-0.5 text-12 ${HUE_CLASSES[hue]}`}
    >
      {children}
    </span>
  )
}
