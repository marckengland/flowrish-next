import Link from 'next/link'

import { EmptyState, MetricCard } from '@/components/dashboard/metric-card'
import type { DealGap } from '@/server/services/rhythm'

export interface DealGapRow {
  leadId: string
  leadName: string
  gaps: readonly DealGap[]
}

export interface DealGapsPanelProps {
  /** Leads whose gap analysis returned at least one gap. */
  leads: readonly DealGapRow[]
  /** Aggregate counts across the full org (not just `leads`). */
  summary: {
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
 * Deal Gaps tab — surfaces structural weaknesses in open deals so the
 * user can address them before they stall the deal (Requirement 9.6).
 *
 * Validates: Requirements 9.6
 */
export function DealGapsPanel({
  leads,
  summary,
}: DealGapsPanelProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          label="No recent activity"
          value={summary.noRecentActivity}
          hint="7+ days silent"
        />
        <MetricCard
          label="No future meeting"
          value={summary.noFutureMeeting}
          hint="Nothing scheduled ahead"
        />
        <MetricCard
          label="Single-threaded"
          value={summary.singleThreaded}
          hint="Only 1 contact linked"
        />
      </div>

      <section
        aria-labelledby="deal-gaps-heading"
        className="rounded-md border bg-card"
      >
        <header className="border-b px-4 py-3">
          <h2
            id="deal-gaps-heading"
            className="text-sm font-semibold text-foreground"
          >
            Deals with gaps
          </h2>
        </header>
        {leads.length === 0 ? (
          <EmptyState
            title="No gaps detected"
            description="Every open deal has recent activity and a scheduled next step."
            className="m-4"
          />
        ) : (
          <ul className="divide-y">
            {leads.map((row) => (
              <li
                key={row.leadId}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <Link
                  href={`/leads/${row.leadId}`}
                  className="truncate text-sm font-medium text-foreground hover:underline"
                >
                  {row.leadName}
                </Link>
                <ul
                  aria-label="Gaps"
                  className="flex flex-wrap gap-1.5 text-xs"
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
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
