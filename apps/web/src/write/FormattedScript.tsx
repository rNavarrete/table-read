import { parseFountainLines, type FountainLineType } from './fountainFormat'

const LINE_CLASS: Record<FountainLineType, string> = {
  blank: 'h-4',
  scene_heading:
    'font-script text-15 font-bold uppercase tracking-[0.02em] leading-[1.65] text-tr-text-primary',
  action:
    'mt-4 font-script text-15 leading-[1.65] text-tr-text-primary first:mt-0',
  character:
    'mt-4 font-script text-15 uppercase leading-[1.65] text-tr-text-primary pl-[22%]',
  parenthetical:
    'font-script text-15 leading-[1.65] text-tr-text-secondary pl-[22%]',
  dialogue: 'font-script text-15 leading-[1.65] text-tr-text-primary pl-[22%]',
  transition:
    'mt-4 text-right font-script text-15 uppercase tracking-[0.02em] leading-[1.65] text-tr-text-primary',
}

export interface FormattedScriptProps {
  text: string
  /** Accessible name for the script block. */
  'aria-label'?: string
  className?: string
  onActivate?: () => void
}

/**
 * Read-only teleplay layout for a beat's Fountain `scriptText` (UI spec §4).
 * Click / Enter activates the plain-text editor (BeatRow).
 */
export function FormattedScript({
  text,
  'aria-label': ariaLabel,
  className = '',
  onActivate,
}: FormattedScriptProps) {
  const lines = parseFountainLines(text)

  return (
    <div
      role={onActivate ? 'button' : undefined}
      tabIndex={onActivate ? 0 : undefined}
      aria-label={ariaLabel}
      data-testid="formatted-script"
      className={
        'w-full text-left outline-none' +
        (onActivate
          ? ' cursor-text rounded-card focus-visible:outline focus-visible:outline-selected focus-visible:outline-tr-coral'
          : '') +
        (className ? ` ${className}` : '')
      }
      onClick={onActivate}
      onKeyDown={
        onActivate
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onActivate()
              }
            }
          : undefined
      }
    >
      {lines.map((line, index) =>
        line.type === 'blank' ? (
          <div key={`b-${index}`} className={LINE_CLASS.blank} aria-hidden />
        ) : (
          <p key={`l-${index}`} className={LINE_CLASS[line.type]}>
            {line.text}
          </p>
        ),
      )}
    </div>
  )
}
