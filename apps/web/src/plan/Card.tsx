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
 * by scene cards (raised) and nested beat cards (sunken). `selected` uses
 * the Quiet Tool soft accent fill documented for Plan selection states.
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
        'rounded-card p-3 ' +
        (selected
          ? `bg-tr-coral-soft text-tr-accent-ink${variant === 'raised' ? ' shadow-raised' : ''}`
          : VARIANT_CLASSES[variant]) +
        (className ? ` ${className}` : '')
      }
      {...rest}
    >
      {children}
    </div>
  )
}
