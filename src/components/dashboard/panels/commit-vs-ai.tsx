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
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          label={`Team commit (${period})`}
          value={formatCurrency(teamCommit)}
        />
        <MetricCard
          label="AI predicted"
          value={formatCurrency(aiPredicted)}
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
        'inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium',
        risk === 'On Track' &&
          'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
        risk === 'At Risk' &&
          'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300',
        risk === 'High Risk' &&
          'border-destructive/30 bg-destructive/10 text-destructive',
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
