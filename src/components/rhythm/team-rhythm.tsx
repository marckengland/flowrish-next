import Link from 'next/link'

import { EmptyState, MetricCard } from '@/components/dashboard/metric-card'

/**
 * Top urgent action shown inline under each rep in the team rhythm view.
 */
export interface TeamRhythmUrgentAction {
  id: string
  title: string
  priorityScore: number
  leadId: string
  leadName: string
  isOverdue: boolean
}

/**
 * Per-rep summary in the team rhythm view. Server-side `calculatePriorityScore`
 * populates `topUrgent` with at most 3 actions in descending priority order.
 */
export interface TeamRhythmRepRow {
  userId: string
  name: string
  email: string | null
  openActionCount: number
  overdueCount: number
  topUrgent: readonly TeamRhythmUrgentAction[]
}

export interface TeamRhythmProps {
  /** All reps accessible to the current manager (including themselves). */
  reps: readonly TeamRhythmRepRow[]
}

/**
 * Manager-only team rhythm view.
 *
 * Aggregates signals across direct reports: total overdue, reps with
 * overdue items, and the top 3 urgent actions per rep (Requirement 9.3).
 * Each urgent action links directly to the corresponding lead so a
 * manager can coach in-context.
 *
 * Validates: Requirement 9.3
 */
export function TeamRhythm({ reps }: TeamRhythmProps): React.JSX.Element {
  if (reps.length === 0) {
    return (
      <EmptyState
        title="No team members to coach"
        description="Invite users or assign members to your teams to see team rhythm signals here."
      />
    )
  }

  const totalOverdue = reps.reduce((n, r) => n + r.overdueCount, 0)
  const totalOpen = reps.reduce((n, r) => n + r.openActionCount, 0)
  const repsWithOverdue = reps.filter((r) => r.overdueCount > 0).length

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Team size" value={reps.length} />
        <MetricCard
          label="Team overdue"
          value={totalOverdue}
          hint={totalOverdue > 0 ? 'Aggregated across reps' : 'Team is on track'}
        />
        <MetricCard
          label="Reps with overdue"
          value={repsWithOverdue}
          hint={`${totalOpen} open total`}
        />
      </div>

      <section
        aria-labelledby="team-rhythm-heading"
        className="rounded-lg border bg-card"
      >
        <header className="border-b px-4 py-3">
          <h2
            id="team-rhythm-heading"
            className="text-sm font-semibold text-foreground"
          >
            Per-rep signals
          </h2>
        </header>
        <ul className="divide-y">
          {reps.map((rep) => (
            <li key={rep.userId} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-foreground">
                    {rep.name}
                  </span>
                  {rep.email ? (
                    <span className="truncate text-xs text-muted-foreground">
                      {rep.email}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
                  <span>{rep.openActionCount} open</span>
                  <span
                    className={
                      rep.overdueCount > 0 ? 'text-destructive' : undefined
                    }
                  >
                    {rep.overdueCount} overdue
                  </span>
                </div>
              </div>
              {rep.topUrgent.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No urgent actions right now.
                </p>
              ) : (
                <ol className="flex flex-col gap-1">
                  {rep.topUrgent.map((action) => (
                    <li
                      key={action.id}
                      className="flex items-start gap-2 text-xs text-muted-foreground tabular-nums"
                    >
                      <span className="inline-flex w-8 shrink-0 justify-end font-semibold text-foreground">
                        {action.priorityScore}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        <span className="text-foreground">{action.title}</span>
                        <span aria-hidden="true"> · </span>
                        <Link
                          href={`/leads/${action.leadId}`}
                          className="hover:underline"
                        >
                          {action.leadName}
                        </Link>
                        {action.isOverdue ? (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span className="text-destructive">Overdue</span>
                          </>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
