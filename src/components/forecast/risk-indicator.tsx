import { cn } from '@/lib/utils'
import type { ForecastRisk } from '@/server/services/forecast'

export interface RiskIndicatorProps {
  /** Risk classification returned by `assessForecastRisk`. */
  risk: ForecastRisk
  /** Optional descriptive suffix shown next to the badge (e.g. period). */
  context?: string
  className?: string
}

/**
 * Visual indicator for the forecast risk level.
 *
 * Renders an accessible badge colored by classification:
 * - On Track — emerald
 * - At Risk  — amber
 * - High Risk — destructive
 *
 * Validates: Requirement 10.3
 */
export function RiskIndicator({
  risk,
  context,
  className,
}: RiskIndicatorProps): React.JSX.Element {
  return (
    <div
      role="status"
      aria-label={`Forecast risk: ${risk}`}
      className={cn(
        'inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium',
        risk === 'On Track' &&
          'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
        risk === 'At Risk' &&
          'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300',
        risk === 'High Risk' &&
          'border-destructive/30 bg-destructive/10 text-destructive',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-2 rounded-full',
          risk === 'On Track' && 'bg-emerald-500',
          risk === 'At Risk' && 'bg-amber-500',
          risk === 'High Risk' && 'bg-destructive',
        )}
      />
      <span>Risk: {risk}</span>
      {context ? (
        <span className="text-xs font-normal text-muted-foreground">
          ({context})
        </span>
      ) : null}
    </div>
  )
}
