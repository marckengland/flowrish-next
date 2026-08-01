import { EmptyState, MetricCard } from '@/components/dashboard/metric-card'
import { cn } from '@/lib/utils'
import type { ForecastRisk } from '@/server/services/forecast'

export interface CommitVsAiPanelProps {
  /** Most recent forecast commit for the current period, if any. */
  teamCommit: number | null
  /** AI predicted pipeline value for the same window. */
  aiPredicted: number
  /** Risk classification — null when there is no commit to compare. */
  risk: ForecastRisk | null
  /** YYYY-MM the commit applies to. */
  period: string
}

/**
 * Commit vs AI tab (Manager only) — compares the submitted forecast
 * commit against the AI-predicted value and surfaces the risk level
 * (Requirement 10.3).
 *
 * Validates: Requirements 10.3
 */
export function CommitVsAiPanel({
  teamCommit,
  aiPredicted,
  risk,
  period,
}: CommitVsAiPanelProps): React.JSX.Element {
  if (teamCommit === null) {
    return (
      <EmptyState
        title={`No forecast submitted for ${period}`}
        description="Submit a team commit from the Forecast page to see the comparison here."
      />
    )
  }

  const gapPct =
    aiPredicted === 0
      ? null
      : ((teamCommit - aiPredicted) / aiPredicted) * 100

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3.5 sm:grid-cols-3">
        <MetricCard
          label={`Team commit (${period})`}
          value={formatCurrency(teamCommit)}
        />
        <MetricCard
          label="AI predicted"
          value={formatCurrency(aiPredicted)}
          tone="brand"
        />
        <MetricCard
          label="Gap"
          value={gapPct === null ? '—' : `${gapPct > 0 ? '+' : ''}${gapPct.toFixed(1)}%`}
          hint={gapPct === null ? 'AI prediction is zero' : undefined}
        />
      </div>

      {risk ? <RiskBadge risk={risk} /> : null}
    </div>
  )
}

function RiskBadge({ risk }: { risk: ForecastRisk }): React.JSX.Element {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-[10px] px-3 py-2 text-sm font-medium',
        risk === 'On Track' && 'bg-brand-subtle text-brand-emphasis',
        risk === 'At Risk' && 'bg-warning-subtle text-warning-foreground',
        risk === 'High Risk' && 'bg-danger-subtle text-danger-foreground',
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
    </div>
  )
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}
