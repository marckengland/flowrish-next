import Link from 'next/link'
import { AlertTriangle, Clock } from 'lucide-react'

import { EmptyState, MetricCard } from '@/components/dashboard/metric-card'
import { cn } from '@/lib/utils'

/**
 * Row shape for a pending action shown in the priority list.
 *
 * Rows are pre-scored by `calculatePriorityScore` on the server and
 * pre-sorted descending so this component stays purely presentational.
 */
export interface PriorityActionRow {
  id: string
  title: string
  description: string | null
  dueDate: Date | string
  priorityScore: number
  priority: 'LOW' | 'MEDIUM' | 'HIGH'
  isOverdue: boolean
  leadId: string
  leadName: string
  leadScore: number | null
  dealValue: number | null
  currency: string
}

export interface PriorityListProps {
  /**
   * Full list of the current user's pending actions, already ranked by
   * priority score descending (Requirement 9.2).
   */
  actions: readonly PriorityActionRow[]
}

/**
 * Rhythm priority list — the primary surface of the rhythm dashboard.
 *
 * Shows every pending action assigned to the current user, ranked by
 * priority score with headline counts at the top. Each row exposes the
 * score, the due context, a deep link to the parent lead, and any
 * additional signal data (deal value, lead score) used to compute the
 * priority.
 *
 * Validates: Requirements 9.1, 9.2
 */
export function PriorityList({ actions }: PriorityListProps): React.JSX.Element {
  const now = new Date()
  const overdueCount = actions.filter((a) => a.isOverdue).length
  const dueTodayCount = actions.filter((a) => isSameDay(a.dueDate, now)).length
  const highPriorityCount = actions.filter((a) => a.priorityScore >= 70).length

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          label="Open actions"
          value={actions.length}
          hint="Everything pending for you"
        />
        <MetricCard
          label="Due today"
          value={dueTodayCount}
          icon={<Clock className="size-4" aria-hidden="true" />}
        />
        <MetricCard
          label="Overdue"
          value={overdueCount}
          icon={<AlertTriangle className="size-4" aria-hidden="true" />}
          hint={
            overdueCount > 0
              ? `${highPriorityCount} high-priority`
              : 'You are caught up'
          }
        />
      </div>

      <section
        aria-labelledby="priority-list-heading"
        className="rounded-md border bg-card"
      >
        <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <h2
            id="priority-list-heading"
            className="text-sm font-semibold text-foreground"
          >
            Prioritized actions
          </h2>
          <span className="text-xs text-muted-foreground tabular-nums">
            {actions.length} total
          </span>
        </header>
        {actions.length === 0 ? (
          <EmptyState
            title="Nothing to do right now"
            description="New actions will be ranked and surfaced here automatically."
            className="m-4"
          />
        ) : (
          <ul className="divide-y">
            {actions.map((action) => (
              <li
                key={action.id}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
              >
                <PriorityBadge score={action.priorityScore} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-foreground">
                    {action.title}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <Link
                      href={`/leads/${action.leadId}`}
                      className="truncate hover:underline"
                    >
                      {action.leadName}
                    </Link>
                    <span aria-hidden="true">·</span>
                    <span className={action.isOverdue ? 'text-destructive' : ''}>
                      {action.isOverdue ? 'Overdue' : 'Due'}{' '}
                      {formatDueDate(action.dueDate)}
                    </span>
                    {action.priority === 'HIGH' ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-medium text-destructive">
                          High priority
                        </span>
                      </>
                    ) : null}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground tabular-nums">
                  {action.dealValue != null ? (
                    <span
                      className="rounded-full bg-muted px-2 py-0.5"
                      title="Deal value"
                    >
                      {formatCurrency(action.dealValue, action.currency)}
                    </span>
                  ) : null}
                  {action.leadScore != null ? (
                    <span
                      className="rounded-full bg-muted px-2 py-0.5"
                      title="Lead score"
                    >
                      Score {action.leadScore}
                    </span>
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

function PriorityBadge({ score }: { score: number }): React.JSX.Element {
  return (
    <span
      aria-label={`Priority score ${score}`}
      className={cn(
        'inline-flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums',
        score >= 70
          ? 'bg-destructive/10 text-destructive'
          : score >= 40
            ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'
            : 'bg-muted text-muted-foreground',
      )}
    >
      {score}
    </span>
  )
}

function formatDueDate(input: Date | string): string {
  const d = input instanceof Date ? input : new Date(input)
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

function formatCurrency(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    // Fallback if the currency code is not recognized by the runtime.
    return `${value.toLocaleString()} ${currency}`
  }
}

function isSameDay(input: Date | string, reference: Date): boolean {
  const d = input instanceof Date ? input : new Date(input)
  return (
    d.getFullYear() === reference.getFullYear() &&
    d.getMonth() === reference.getMonth() &&
    d.getDate() === reference.getDate()
  )
}
