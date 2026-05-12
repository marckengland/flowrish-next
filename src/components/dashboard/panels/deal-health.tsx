import Link from 'next/link'

import { EmptyState, MetricCard } from '@/components/dashboard/metric-card'
import { cn } from '@/lib/utils'
import type { DealHealth } from '@/server/services/rhythm'

export interface DealHealthRow {
  leadId: string
  leadName: string
  engagementScore: number
  health: DealHealth
  dealValue: number | null
}

export interface DealHealthPanelProps {
  /** Leads already scored and classified on the server, sorted by score ascending. */
  leads: readonly DealHealthRow[]
  /** Count of leads in each health bucket across the full org (not just `leads`). */
  summary: {
    healthy: number
    atRisk: number
    critical: number
  }
}

/**
 * Deal Health tab — shows aggregate counts per health classification plus
 * the worst-scoring deals so the user can triage at-risk / critical
 * opportunities first (Requirement 9.4, 9.5).
 *
 * Validates: Requirements 9.4, 9.5
 */
export function DealHealthPanel({
  leads,
  summary,
}: DealHealthPanelProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          label="Healthy"
          value={summary.healthy}
          hint="Score ≥ 60"
        />
        <MetricCard
          label="At risk"
          value={summary.atRisk}
          hint="Score 35–59"
        />
        <MetricCard
          label="Critical"
          value={summary.critical}
          hint="Score < 35"
        />
      </div>

      <section
        aria-labelledby="deal-health-heading"
        className="rounded-md border bg-card"
      >
        <header className="border-b px-4 py-3">
          <h2
            id="deal-health-heading"
            className="text-sm font-semibold text-foreground"
          >
            Lowest-scoring deals
          </h2>
        </header>
        {leads.length === 0 ? (
          <EmptyState
            title="No open deals to score"
            description="Deals will appear here once they progress through your pipeline."
            className="m-4"
          />
        ) : (
          <ul className="divide-y">
            {leads.map((row) => (
              <li key={row.leadId} className="flex items-center gap-3 px-4 py-3">
                <HealthBadge health={row.health} score={row.engagementScore} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <Link
                    href={`/leads/${row.leadId}`}
                    className="truncate text-sm font-medium text-foreground hover:underline"
                  >
                    {row.leadName}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {row.dealValue != null
                      ? formatCurrency(row.dealValue)
                      : 'No deal value set'}
                  </span>
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
  health: DealHealth
  score: number
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium',
        health === 'Healthy'
          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'
          : health === 'At Risk'
            ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'
            : 'bg-destructive/10 text-destructive',
      )}
    >
      <span className="tabular-nums">{score}</span>
      <span>{health}</span>
    </span>
  )
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}
