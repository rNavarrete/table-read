import type { ReactNode } from 'react'
import type { PlanSectionId } from './useSectionOpenState'

export interface PanelSectionProps {
  id: PlanSectionId
  /** "What the scene does" | "Who wants what" | "What it touches" | "Beats" | "Details" */
  title: string
  /** Rendered as "Title (n)" (Who wants what, Beats). */
  count?: number
  /** Muted "steers Next Beat" note (sections 1–2: these fields feed every Next Beat prompt). */
  steersNextBeat?: boolean
  open: boolean
  onToggle: (open: boolean) => void
  children: ReactNode
}

/**
 * One scene-panel section (spec §4.6): a native `<details>` whose open state
 * the caller persists (useSectionOpenState). `id="plan-section-{id}"` plus
 * `data-plan-section` is the DOM contract ScenePanel's scroll-spy and jump
 * bar read.
 */
export function PanelSection({
  id,
  title,
  count,
  steersNextBeat = false,
  open,
  onToggle,
  children,
}: PanelSectionProps) {
  return (
    <details
      id={`plan-section-${id}`}
      data-plan-section={id}
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
      className="group border-t border-tr-border"
    >
      <summary className="flex cursor-pointer items-baseline gap-2 px-4 py-3 focus-visible:outline focus-visible:outline-selected focus-visible:-outline-offset-2 focus-visible:outline-tr-sky">
        <span
          aria-hidden="true"
          className="text-13 text-tr-text-secondary transition-transform group-open:rotate-90 motion-reduce:transition-none"
        >
          ›
        </span>
        <span className="text-13 font-semibold text-tr-text-primary">
          {count === undefined ? title : `${title} (${count})`}
        </span>
        {steersNextBeat && (
          <span className="ml-auto text-11 text-tr-text-secondary">
            steers Next Beat
          </span>
        )}
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  )
}
