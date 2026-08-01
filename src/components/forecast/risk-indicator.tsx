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
        'inline-flex items-center gap-2 rounded-[10px] px-3 py-2 text-[12.5px] font-medium',
        risk === 'On Track' && 'bg-brand-subtle text-brand-emphasis',
        risk === 'At Risk' && 'bg-warning-subtle text-warning-foreground',
        risk === 'High Risk' && 'bg-danger-subtle text-danger-foreground',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-2 rounded-full',
          risk === 'On Track' && 'bg-brand',
          risk === 'At Risk' && 'bg-warning',
          risk === 'High Risk' && 'bg-danger',
        )}
      />
      <span>Risk: {risk}</span>
      {context ? (
        <span className="text-xs font-normal opacity-80">({context})</span>
      ) : null}
    </div>
  )
}
