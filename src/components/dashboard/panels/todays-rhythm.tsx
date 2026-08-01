import Link from 'next/link'
import { Clock, AlertTriangle } from 'lucide-react'

import { EmptyState, MetricCard } from '@/components/dashboard/metric-card'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { ScoreCircle } from '@/components/scoring/score-badge'

/**
 * Row shape for a pending action shown in the Today's Rhythm panel.
 * Already pre-sorted by priority score descending on the server.
 */
export interface RhythmActionRow {
  id: string
  title: string
  dueDate: Date | string | null
  priorityScore: number
  isOverdue: boolean
  leadId: string
  leadName: string
}

export interface TodaysRhythmPanelProps {
  /** Top-N actions already ranked by priority score (descending). */
  actions: readonly RhythmActionRow[]
  /** Total count of overdue actions (may exceed the rows above). */
  overdueCount: number
  /** Total count of pending actions due today (or earlier). */
  todayCount: number
  /** Total count of all open actions. */
  openCount: number
}

/**
 * Today's Rhythm tab — shows the highest-priority actions the current user
 * should take right now, plus headline counts of what's open / overdue.
 *
 * Rows are pre-ranked on the server by `calculatePriorityScore` so the
 * panel itself is purely presentational (Requirement 9.2).
 *
 * Validates: Requirements 9.1, 9.2
 */
export function TodaysRhythmPanel({
  actions,
  overdueCount,
  todayCount,
  openCount,
}: TodaysRhythmPanelProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3.5 sm:grid-cols-3">
        <MetricCard
          label="Open actions"
          value={openCount}
          hint="All pending tasks assigned to you"
        />
        <MetricCard
          label="Due today"
          value={todayCount}
          icon={<Clock className="size-4" aria-hidden="true" />}
        />
        <MetricCard
          label="Overdue"
          value={overdueCount}
          tone={overdueCount > 0 ? 'danger' : 'default'}
          icon={<AlertTriangle className="size-4" aria-hidden="true" />}
          hint={overdueCount > 0 ? 'Needs attention' : 'You are caught up'}
        />
      </div>

      <Card aria-labelledby="todays-rhythm-heading" className="overflow-hidden">
        <CardHeader>
          <CardTitle id="todays-rhythm-heading">Top priorities</CardTitle>
          <Link
            href="/rhythm"
            title="Open the full Rhythm queue"
            className="eyebrow text-brand-emphasis transition-opacity hover:opacity-70"
          >
            View all →
          </Link>
        </CardHeader>
        {actions.length === 0 ? (
          <EmptyState
            title="Nothing prioritized right now"
            description="New high-priority actions will appear here as work comes in."
            className="m-[18px]"
          />
        ) : (
          <ul className="divide-y divide-row-divider">
            {actions.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-3.5 px-[18px] py-3 transition-colors hover:bg-background"
              >
                <ScoreCircle score={a.priorityScore} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-foreground">
                    {a.title}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    <Link
                      href={`/leads/${a.leadId}`}
                      className="hover:underline"
                    >
                      {a.leadName}
                    </Link>
                    {a.dueDate ? (
                      <>
                        <span className="mx-1">·</span>
                        <span
                          className={a.isOverdue ? 'text-danger-foreground' : ''}
                        >
                          {a.isOverdue ? 'Overdue' : 'Due'}{' '}
                          {formatDueDate(a.dueDate)}
                        </span>
                      </>
                    ) : null}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function formatDueDate(input: Date | string): string {
  const d = input instanceof Date ? input : new Date(input)
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}
