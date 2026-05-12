import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface MetricCardProps {
  /** Short label describing the metric. */
  label: string
  /** Primary value shown prominently. */
  value: ReactNode
  /** Optional supporting text (delta, context, trend). */
  hint?: ReactNode
  /** Optional leading icon — render a Lucide icon or similar. */
  icon?: ReactNode
  className?: string
}

/**
 * Reusable metric card used across the dashboard tabs. Renders a labeled
 * headline value with optional supporting context. Kept as a pure
 * presentational Server Component so it can be shared freely between
 * panels without forcing client hydration.
 */
export function MetricCard({
  label,
  value,
  hint,
  icon,
  className,
}: MetricCardProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-md border bg-card p-4 text-card-foreground shadow-sm',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span>{label}</span>
        {icon ? (
          <span aria-hidden="true" className="text-muted-foreground/80">
            {icon}
          </span>
        ) : null}
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {hint ? (
        <div className="text-xs text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  )
}

/**
 * Simple empty-state block for panels with no data. Keeps the visual
 * grammar consistent with MetricCard (same border/background) without
 * actually displaying a metric.
 */
export function EmptyState({
  title,
  description,
  className,
}: {
  title: string
  description?: string
  className?: string
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'rounded-md border border-dashed bg-card p-6 text-center text-sm text-muted-foreground',
        className,
      )}
    >
      <p className="font-medium text-foreground">{title}</p>
      {description ? (
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      ) : null}
    </div>
  )
}
