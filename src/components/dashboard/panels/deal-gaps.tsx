import Link from 'next/link'

import { EmptyState, MetricCard } from '@/components/dashboard/metric-card'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
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
      <div className="grid gap-3.5 sm:grid-cols-3">
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

      <Card aria-labelledby="deal-gaps-heading" className="overflow-hidden">
        <CardHeader>
          <CardTitle id="deal-gaps-heading">Deals with gaps</CardTitle>
        </CardHeader>
        {leads.length === 0 ? (
          <EmptyState
            title="No gaps detected"
            description="Every open deal has recent activity and a scheduled next step."
            className="m-[18px]"
          />
        ) : (
          <ul className="divide-y divide-row-divider">
            {leads.map((row) => (
              <li
                key={row.leadId}
                className="flex flex-col gap-2 px-[18px] py-3 transition-colors hover:bg-background sm:flex-row sm:items-center sm:justify-between"
              >
                <Link
                  href={`/leads/${row.leadId}`}
                  className="truncate text-sm font-medium text-foreground hover:underline"
                >
                  {row.leadName}
                </Link>
                <ul aria-label="Gaps" className="flex flex-wrap gap-1.5">
                  {row.gaps.map((gap) => (
                    <li key={gap}>
                      <Badge variant="warning" size="sm">
                        {GAP_LABELS[gap]}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
