import type { HTMLAttributes, ReactNode } from 'react'

export type CardVariant = 'raised' | 'sunken'

const VARIANT_CLASSES: Record<CardVariant, string> = {
  raised: 'bg-tr-surface-raised shadow-raised',
  sunken: 'bg-tr-surface-sunken',
}

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant: CardVariant
  selected?: boolean
  children: ReactNode
}

/**
 * `Card` — §7's component inventory: raised/sunken surface variants shared
 * by scene cards (raised) and nested beat cards (sunken). `selected` renders
 * the UI spec §4 "2px coral outline" via the minted `--tr-outline-selected`
 * token (Tailwind's `outline-selected` utility — see tokens.css).
 */
export function Card({
  variant,
  selected,
  className = '',
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={
        `rounded-card p-3 ${VARIANT_CLASSES[variant]}` +
        (selected ? ' outline outline-selected outline-tr-coral' : '') +
        (className ? ` ${className}` : '')
      }
      {...rest}
    >
      {children}
    </div>
  )
}
