import {
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  useState,
} from 'react'

export const TRUST_NOTE =
  'Every AI step is explicit, reviewable, and begins only after you confirm the source material.'

export interface WizardStep {
  id: string
  label: string
  title: string
  body: ReactNode
  validate?: () => boolean
}

interface WizardShellProps {
  title: string
  steps: WizardStep[]
  cancelHref?: string
  hasEnteredData?: boolean
  trustNote?: ReactNode
  finalActionLabel?: string
  onFinalAction?: () => void
  isFinalActionDisabled?: boolean
  // Uncontrolled navigation (Back/Continue) is the norm; this is only for a
  // parent that occasionally needs to *force* a jump — e.g. the import
  // wizard's failure recovery "Edit source" action (design doc §7 step 4)
  // jumping back to the source step from Analyze. `token` must change (e.g.
  // an incrementing counter) each time the parent wants a jump to fire, even
  // to the same `stepId` as last time; normal Back/Continue clicks keep
  // working in between jumps.
  jumpTo?: { stepId: string; token: number }
}

function focusFirstInvalidField() {
  const invalid = document.querySelector<HTMLElement>(
    '[aria-invalid="true"], [data-invalid="true"], input:invalid, textarea:invalid, select:invalid',
  )
  invalid?.focus()
}

export function WizardShell({
  title,
  steps,
  cancelHref = '/projects',
  hasEnteredData = false,
  trustNote = TRUST_NOTE,
  finalActionLabel = 'Continue',
  onFinalAction,
  isFinalActionDisabled = false,
  jumpTo,
}: WizardShellProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  // "Adjusting state during render" (react.dev), not an effect: a jump is a
  // one-shot response to a prop change, not a subscription to an external
  // system, so this avoids the extra render an effect-based setState causes.
  const [lastJumpToken, setLastJumpToken] = useState(jumpTo?.token)
  if (jumpTo !== undefined && jumpTo.token !== lastJumpToken) {
    setLastJumpToken(jumpTo.token)
    const index = steps.findIndex((step) => step.id === jumpTo.stepId)
    if (index !== -1) setCurrentIndex(index)
  }
  const currentStep = steps[currentIndex]
  const isFirstStep = currentIndex === 0
  const isLastStep = currentIndex === steps.length - 1

  function handleContinue() {
    if (currentStep.validate && !currentStep.validate()) {
      focusFirstInvalidField()
      return
    }
    if (!isLastStep) {
      setCurrentIndex((index) => index + 1)
      return
    }
    onFinalAction?.()
  }

  function handleCancel(event: MouseEvent<HTMLAnchorElement>) {
    if (!hasEnteredData) return
    if (!window.confirm('Discard this local draft and return to projects?')) {
      event.preventDefault()
    }
  }

  return (
    <div className="min-h-screen bg-tr-surface-page">
      <header className="flex h-shell-height items-center gap-4 bg-tr-surface-sunken px-6">
        <a
          href="/projects"
          className="font-display text-17 font-semibold text-tr-text-primary"
        >
          Table Read
        </a>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
        <div>
          <p className="text-12 uppercase tracking-wide text-tr-text-muted">
            New project
          </p>
          <h1 className="mt-2 font-display text-28 font-semibold text-tr-text-primary">
            {title}
          </h1>
        </div>

        <ol
          aria-label="Wizard steps"
          className="grid gap-2 text-13 text-tr-text-secondary sm:grid-cols-[repeat(var(--wizard-step-count),minmax(0,1fr))]"
          style={{ '--wizard-step-count': steps.length } as CSSProperties}
        >
          {steps.map((step, index) => (
            <li
              key={step.id}
              aria-current={index === currentIndex ? 'step' : undefined}
              className={
                index === currentIndex
                  ? 'rounded-chip bg-tr-coral-soft px-3 py-2 font-medium text-tr-accent-ink'
                  : 'rounded-chip bg-tr-surface-raised px-3 py-2'
              }
            >
              {step.label}
            </li>
          ))}
        </ol>

        <section className="rounded-card border border-tr-border bg-tr-surface-raised p-6 shadow-raised">
          <h2 className="font-display text-22 font-semibold text-tr-text-primary">
            {currentStep.title}
          </h2>
          <div className="mt-4 text-15 leading-7 text-tr-text-secondary">
            {currentStep.body}
          </div>
        </section>

        <p className="rounded-card border border-tr-border bg-tr-surface-sunken px-4 py-3 text-13 leading-6 text-tr-text-secondary">
          {trustNote}
        </p>

        <div className="flex items-center gap-3">
          <a
            href={cancelHref}
            onClick={handleCancel}
            className="rounded-card border border-tr-border px-4 py-2 text-13 font-medium text-tr-text-secondary hover:border-tr-border-strong hover:text-tr-text-primary"
          >
            Cancel
          </a>
          <button
            type="button"
            disabled={isFirstStep}
            onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}
            className="rounded-card border border-tr-border px-4 py-2 text-13 font-medium text-tr-text-secondary hover:border-tr-border-strong hover:text-tr-text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            Back
          </button>
          <button
            type="button"
            onClick={handleContinue}
            disabled={isLastStep && isFinalActionDisabled}
            className="ml-auto rounded-card bg-tr-coral px-4 py-2 text-13 font-medium text-tr-surface-raised transition hover:bg-tr-coral-hover"
          >
            {isLastStep ? finalActionLabel : 'Continue'}
          </button>
        </div>
      </main>
    </div>
  )
}
