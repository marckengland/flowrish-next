import Link from 'next/link'

import { EmptyState, MetricCard } from '@/components/dashboard/metric-card'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
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
      <div className="grid gap-3.5 sm:grid-cols-3">
        <MetricCard
          label="Healthy"
          value={summary.healthy}
          tone="brand"
          hint="Score ≥ 60"
        />
        <MetricCard
          label="At risk"
          value={summary.atRisk}
          tone="warning"
          hint="Score 35–59"
        />
        <MetricCard
          label="Critical"
          value={summary.critical}
          tone="danger"
          hint="Score < 35"
        />
      </div>

      <Card aria-labelledby="deal-health-heading" className="overflow-hidden">
        <CardHeader>
          <CardTitle id="deal-health-heading">Lowest-scoring deals</CardTitle>
        </CardHeader>
        {leads.length === 0 ? (
          <EmptyState
            title="No open deals to score"
            description="Deals will appear here once they progress through your pipeline."
            className="m-[18px]"
          />
        ) : (
          <ul className="divide-y divide-row-divider">
            {leads.map((row) => (
              <li
                key={row.leadId}
                className="flex items-center gap-3.5 px-[18px] py-3 transition-colors hover:bg-background"
              >
                <span
                  className={cn(
                    'w-7 shrink-0 text-xs font-semibold tnum',
                    HEALTH_TEXT[row.health],
                  )}
                >
                  {row.engagementScore}
                </span>
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
                <Badge variant={HEALTH_VARIANT[row.health]} size="sm">
                  {row.health}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

const HEALTH_VARIANT: Record<DealHealth, NonNullable<BadgeProps['variant']>> = {
  Healthy: 'brand',
  'At Risk': 'warning',
  Critical: 'danger',
}

const HEALTH_TEXT: Record<DealHealth, string> = {
  Healthy: 'text-brand-emphasis',
  'At Risk': 'text-warning-foreground',
  Critical: 'text-danger-foreground',
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}
