import Link from 'next/link'

import { EmptyState, MetricCard } from '@/components/dashboard/metric-card'
import { cn } from '@/lib/utils'
import type { DealGap, DealHealth as DealHealthLevel } from '@/server/services/rhythm'

export interface DealHealthRow {
  leadId: string
  leadName: string
  engagementScore: number
  health: DealHealthLevel
  dealValue: number | null
  currency: string
  gaps: readonly DealGap[]
}

export interface DealHealthProps {
  /**
   * Open leads scored and classified on the server, ordered by engagement
   * score ascending so the lowest-health deals are surfaced first.
   */
  leads: readonly DealHealthRow[]
  /** Aggregate counts per health bucket across all open leads. */
  summary: {
    healthy: number
    atRisk: number
    critical: number
  }
  /** Aggregate gap counts across all open leads. */
  gapSummary: {
    noRecentActivity: number
    noFutureMeeting: number
    singleThreaded: number
  }
}

const GAP_LABELS: Record<DealGap, string> = {
  no_recent_activity: 'No recent activity',
  no_future_meeting: 'No future meeting',
  single_threaded: 'Single-threaded',
}

/**
 * Deal Health panel for the rhythm dashboard.
 *
 * Shows aggregate health counts, the lowest-scoring open deals with their
 * engagement score and classification, plus any structural gaps detected
 * by the rhythm service (no activity, no future meeting, single-threaded).
 *
 * Validates: Requirements 9.4, 9.5, 9.6
 */
export function DealHealth({
  leads,
  summary,
  gapSummary,
}: DealHealthProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Healthy" value={summary.healthy} hint="Score ≥ 60" />
        <MetricCard label="At risk" value={summary.atRisk} hint="Score 35–59" />
        <MetricCard label="Critical" value={summary.critical} hint="Score < 35" />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          label="No recent activity"
          value={gapSummary.noRecentActivity}
          hint="7+ days silent"
        />
        <MetricCard
          label="No future meeting"
          value={gapSummary.noFutureMeeting}
          hint="Nothing scheduled ahead"
        />
        <MetricCard
          label="Single-threaded"
          value={gapSummary.singleThreaded}
          hint="Only 1 contact linked"
        />
      </div>

      <section
        aria-labelledby="rhythm-deal-health-heading"
        className="rounded-lg border bg-card"
      >
        <header className="border-b px-4 py-3">
          <h2
            id="rhythm-deal-health-heading"
            className="text-sm font-semibold text-foreground"
          >
            Deals that need attention
          </h2>
        </header>
        {leads.length === 0 ? (
          <EmptyState
            title="No open deals to score"
            description="Deal engagement scores will appear here as leads progress through the pipeline."
            className="m-4"
          />
        ) : (
          <ul className="divide-y">
            {leads.map((row) => (
              <li
                key={row.leadId}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
              >
                <HealthBadge health={row.health} score={row.engagementScore} />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Link
                    href={`/leads/${row.leadId}`}
                    className="truncate text-sm font-medium text-foreground hover:underline"
                  >
                    {row.leadName}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {row.dealValue != null
                      ? formatCurrency(row.dealValue, row.currency)
                      : 'No deal value set'}
                  </span>
                  {row.gaps.length > 0 ? (
                    <ul
                      aria-label="Gaps"
                      className="flex flex-wrap gap-1 text-xs"
                    >
                      {row.gaps.map((gap) => (
                        <li
                          key={gap}
                          className="rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground"
                        >
                          {GAP_LABELS[gap]}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function HealthBadge({
  health,
  score,
}: {
  health: DealHealthLevel
  score: number
}): React.JSX.Element {
  return (
    <span
      aria-label={`Engagement score ${score}, ${health}`}
      className={cn(
        'inline-flex items-center gap-2 self-start rounded-full px-2.5 py-1 text-xs font-medium',
        health === 'Healthy'
          ? 'bg-brand-subtle text-brand-emphasis'
          : health === 'At Risk'
            ? 'bg-warning-subtle text-warning-foreground'
            : 'bg-danger-subtle text-danger-foreground',
      )}
    >
      <span className="tabular-nums">{score}</span>
      <span>{health}</span>
    </span>
  )
}

function formatCurrency(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `${value.toLocaleString()} ${currency}`
  }
}
