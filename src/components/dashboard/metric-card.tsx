import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type MetricTone = 'default' | 'brand' | 'warning' | 'danger'

export interface MetricCardProps {
  /** Short label describing the metric. */
  label: string
  /** Primary value shown prominently. */
  value: ReactNode
  /** Optional supporting text (delta, context, trend). */
  hint?: ReactNode
  /** Optional leading icon — render a Lucide icon or similar. */
  icon?: ReactNode
  /** Colors the value + hint to convey positive/at-risk/critical states. */
  tone?: MetricTone
  className?: string
}

const TONE_VALUE: Record<MetricTone, string> = {
  default: 'text-foreground',
  brand: 'text-brand-emphasis',
  warning: 'text-warning-foreground',
  danger: 'text-danger-foreground',
}

const TONE_HINT: Record<MetricTone, string> = {
  default: 'text-muted-foreground',
  brand: 'text-brand-emphasis',
  warning: 'text-warning-foreground',
  danger: 'text-danger-foreground',
}

/**
 * Reusable metric card used across the dashboard tabs and forecast.
 *
 * Design: white card, hairline border, mono uppercase eyebrow label, a
 * 28px tabular-nums headline value, and an optional supporting line. The
 * `tone` prop tints the value + hint for positive/at-risk/critical states.
 */
export function MetricCard({
  label,
  value,
  hint,
  icon,
  tone = 'default',
  className,
}: MetricCardProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col rounded-lg border bg-card p-4 text-card-foreground',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow">{label}</span>
        {icon ? (
          <span aria-hidden="true" className="text-muted-foreground/80">
            {icon}
          </span>
        ) : null}
      </div>
      <div className={cn('mt-2.5 text-[28px] font-semibold tnum leading-none', TONE_VALUE[tone])}>
        {value}
      </div>
      {hint ? (
        <div className={cn('mt-1.5 text-xs', TONE_HINT[tone])}>{hint}</div>
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
        'rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground',
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
