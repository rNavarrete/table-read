import { parseFountainLines, type FountainLineType } from './fountainFormat'

const LINE_CLASS: Record<FountainLineType, string> = {
  blank: 'h-3',
  scene_heading:
    'font-script text-12 font-bold uppercase leading-relaxed text-tr-text-primary',
  action: 'font-script text-12 leading-relaxed text-tr-text-primary',
  character:
    'mt-3 font-script text-12 uppercase leading-relaxed text-tr-text-primary ml-[22ch]',
  parenthetical:
    'font-script text-12 leading-relaxed text-tr-text-primary ml-[16ch] max-w-[25ch]',
  dialogue:
    'font-script text-12 leading-relaxed text-tr-text-primary ml-[10ch] max-w-[35ch]',
  transition:
    'mt-3 font-script text-12 uppercase leading-relaxed text-tr-text-secondary text-right',
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
        'w-full max-w-[60ch] text-left outline-none' +
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
