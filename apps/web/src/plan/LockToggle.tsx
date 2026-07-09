function LockGlyph({ locked }: { locked: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      {locked ? (
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      ) : (
        <path d="M8 11V7a4 4 0 0 1 7.6-1.8" />
      )}
    </svg>
  )
}

export interface LockToggleProps {
  locked: boolean
  label: string
  onChange: (next: boolean) => void
  disabled?: boolean
}

/**
 * `LockToggle` — §7's component inventory. Locking is always allowed
 * (obligation 4: "a lock flip on a locked object is the writer's own pin —
 * allowed; it's how unlocking works"), so this control is never disabled by
 * its own locked state — only `disabled` (a save in flight) turns it off.
 * Status doubled with text, not color alone (UI spec §8): the glyph shape
 * changes (shackle open/closed) and the label reads "Locked"/"Unlocked".
 */
export function LockToggle({
  locked,
  label,
  onChange,
  disabled,
}: LockToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={locked}
      disabled={disabled}
      onClick={() => onChange(!locked)}
      className={
        'flex items-center gap-2 rounded-card border border-tr-border px-3 py-1.5 text-13 transition-colors motion-reduce:transition-none disabled:opacity-50' +
        (locked
          ? ' bg-tr-coral-soft text-tr-text-primary'
          : ' bg-tr-surface-raised text-tr-text-secondary')
      }
    >
      <LockGlyph locked={locked} />
      {label}: {locked ? 'Locked' : 'Unlocked'}
    </button>
  )
}
