import { MetricCard } from '@/components/dashboard/metric-card'

export interface ForecastPanelProps {
  /** Sum of open deal values. */
  totalPipeline: number
  /** Sum of (deal value × stage win probability). */
  weightedPipeline: number
  /** 70% weighted + 30% monthly run rate. */
  aiPredicted: number
  /** Historical win rate from the last 90 days (0-100). */
  winRate?: number
}

/**
 * Forecast-page headline panel.
 *
 * Renders the three pipeline metrics prescribed by Requirement 10.1
 * (Total, Weighted, AI predicted) plus an optional Win Rate card backed
 * by Requirement 10.5. Kept as a pure presentational Server Component so
 * it can be composed directly into the `/forecast` Server Component
 * without a client boundary.
 *
 * Sibling dashboard-tab panel lives at
 * `@/components/dashboard/panels/forecast` — this one is the dedicated
 * forecast-page variant so the two can evolve independently without
 * coupling to the tab layout.
 *
 * Validates: Requirements 10.1, 10.5
 */
export function ForecastPanel({
  totalPipeline,
  weightedPipeline,
  aiPredicted,
  winRate,
}: ForecastPanelProps): React.JSX.Element {
  const showWinRate = typeof winRate === 'number'
  return (
    <div
      className={
        showWinRate
          ? 'grid gap-3 sm:grid-cols-2 lg:grid-cols-4'
          : 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3'
      }
    >
      <MetricCard
        label="Total pipeline"
        value={formatCurrency(totalPipeline)}
        hint="Sum of open deal values"
      />
      <MetricCard
        label="Weighted pipeline"
        value={formatCurrency(weightedPipeline)}
        hint="Value × stage win probability"
      />
      <MetricCard
        label="AI predicted"
        value={formatCurrency(aiPredicted)}
        hint="70% weighted + 30% monthly run rate"
        tone="brand"
      />
      {showWinRate ? (
        <MetricCard
          label="Win rate (90d)"
          value={`${winRate!.toFixed(1)}%`}
          hint="Closed won ÷ total closed"
        />
      ) : null}
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
