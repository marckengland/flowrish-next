import Link from 'next/link'
import { Clock, AlertTriangle } from 'lucide-react'

import { EmptyState, MetricCard } from '@/components/dashboard/metric-card'
import { cn } from '@/lib/utils'

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
      <div className="grid gap-3 sm:grid-cols-3">
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
          icon={<AlertTriangle className="size-4" aria-hidden="true" />}
          hint={overdueCount > 0 ? 'Needs attention' : 'You are caught up'}
        />
      </div>

      <section
        aria-labelledby="todays-rhythm-heading"
        className="rounded-md border bg-card"
      >
        <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <h2
            id="todays-rhythm-heading"
            className="text-sm font-semibold text-foreground"
          >
            Top priorities
          </h2>
          <Link
            href="/rhythm"
            className="text-xs font-medium text-primary hover:underline"
          >
            View all
          </Link>
        </header>
        {actions.length === 0 ? (
          <EmptyState
            title="Nothing prioritized right now"
            description="New high-priority actions will appear here as work comes in."
            className="m-4"
          />
        ) : (
          <ul className="divide-y">
            {actions.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                <span
                  aria-hidden="true"
                  className={cn(
                    'inline-flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                    a.priorityScore >= 70
                      ? 'bg-destructive/10 text-destructive'
                      : a.priorityScore >= 40
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'
                        : 'bg-muted text-muted-foreground',
                  )}
                >
                  {a.priorityScore}
                </span>
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
                        <span className={a.isOverdue ? 'text-destructive' : ''}>
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
      </section>
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
