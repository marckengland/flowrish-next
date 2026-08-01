import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface PageHeaderProps {
  /** Page H1 (24px / 700 / -0.02em per the design). */
  title: ReactNode
  /** Optional subtitle / supporting line under the title. */
  description?: ReactNode
  /** Right-aligned actions (buttons, filters). */
  actions?: ReactNode
  className?: string
}

/**
 * Standard page header used across dashboard screens: a 24px bold title
 * with an optional muted subtitle on the left and right-aligned actions.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: PageHeaderProps): React.JSX.Element {
  return (
    <header
      className={cn(
        'flex flex-wrap items-start justify-between gap-4',
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-[24px] font-bold leading-tight tracking-[-0.02em] text-foreground">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2.5">{actions}</div>
      ) : null}
    </header>
  )
}
