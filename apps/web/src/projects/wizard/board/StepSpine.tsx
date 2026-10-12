import type { CSSProperties } from 'react'
import type { ProjectImportStageName } from 'contract'
import type { StageStatus } from '../importProgress'

// The nine import steps as a spine (UI spec §2a). Each step says its status
// in words; the dot and the pulse only repeat it.

const STEPS: { stage: ProjectImportStageName; label: string }[] = [
  { stage: 'parsing_scenes', label: 'Reading' },
  { stage: 'segmenting_beats', label: 'Beats' },
  { stage: 'inferring_acts', label: 'Acts' },
  { stage: 'inferring_entities', label: 'Cast' },
  { stage: 'inferring_promises', label: 'Threads' },
  { stage: 'inferring_overview', label: 'Logline' },
  { stage: 'extracting_facts', label: 'Facts' },
  { stage: 'checking_consistency', label: 'Continuity' },
  { stage: 'saving', label: 'Saving' },
]

const STATUS_TEXT: Record<StageStatus, string> = {
  done: 'done',
  now: 'in progress',
  waiting: 'waiting',
  stopped: 'Stopped',
}

const DOT: Record<StageStatus, string> = {
  done: 'border-tr-coral bg-tr-coral',
  now: 'border-tr-coral bg-tr-surface-page shadow-[0_0_0_4px_var(--tr-coral-soft)] animate-[tr-board-pulse_1.8s_ease-in-out_infinite]',
  waiting: 'border-tr-border-strong bg-tr-surface-page',
  stopped: 'border-tr-amber bg-tr-amber-soft',
}

const TEXT: Record<StageStatus, string> = {
  done: 'text-tr-text-secondary',
  now: 'font-medium text-tr-text-primary',
  waiting: 'text-tr-text-muted',
  stopped: 'font-medium text-tr-amber',
}

export function StepSpine({
  statusOf,
}: {
  statusOf: (stage: ProjectImportStageName) => StageStatus
}) {
  const statuses = STEPS.map(({ stage }) => statusOf(stage))
  const reached = statuses.filter((s) => s === 'done').length
  return (
    <ol
      aria-label="Import steps"
      className="relative grid grid-cols-9 before:absolute before:inset-x-[4%] before:top-[5px] before:h-px before:bg-tr-border-strong after:absolute after:left-[4%] after:top-[5px] after:h-px after:w-(--fill) after:bg-tr-coral after:transition-[width] after:duration-[600ms] after:ease-settle"
      style={
        { '--fill': `${(Math.min(reached, 8) / 8) * 92}%` } as CSSProperties
      }
    >
      {STEPS.map(({ stage, label }, k) => {
        const status = statuses[k]
        return (
          <li
            key={stage}
            data-testid={`board-step-${stage}`}
            data-status={status}
            aria-current={status === 'now' ? 'step' : undefined}
            className={`relative z-[1] flex flex-col items-center gap-2 text-11 ${TEXT[status]}`}
          >
            <i
              aria-hidden="true"
              className={`size-[11px] rounded-full border transition-colors duration-300 ${DOT[status]}`}
            />
            <span>{label}</span>
            {status === 'stopped' ? (
              <span>{STATUS_TEXT.stopped}</span>
            ) : (
              <span className="sr-only">{STATUS_TEXT[status]}</span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
