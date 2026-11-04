import { MetricCard } from '@/components/dashboard/metric-card'

export interface ForecastPanelProps {
  totalPipeline: number
  weightedPipeline: number
  aiPredicted: number
  winRate: number
}

/**
 * Forecast tab — the three headline pipeline metrics plus the 90-day win
 * rate (Requirement 10.1, 10.5). Manager-only deeper comparison lives in
 * the Commit vs AI tab.
 *
 * Validates: Requirements 10.1, 10.5
 */
export function ForecastPanel({
  totalPipeline,
  weightedPipeline,
  aiPredicted,
  winRate,
}: ForecastPanelProps): React.JSX.Element {
  return (
    <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
      <p className="col-span-full text-xs text-muted-foreground">Money values use USD only; other currencies are excluded without conversion. Win rate counts all currencies.</p>
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
        tone="brand"
        hint="70% weighted + 30% monthly run rate"
      />
      <MetricCard
        label="Win rate (90d)"
        value={`${winRate.toFixed(1)}%`}
        hint="Closed won ÷ total closed"
      />
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
