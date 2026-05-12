import { MetricCard, EmptyState } from '@/components/dashboard/metric-card'

/**
 * Per-rep summary shown in the Team View tab. The server pre-computes the
 * top 3 urgent action titles and the overdue count so the panel is a
 * straightforward render.
 */
export interface TeamRepSummary {
  userId: string
  name: string
  overdueCount: number
  /** Top N (≤3) urgent action titles, in priority-descending order. */
  topUrgent: readonly { id: string; title: string; priorityScore: number }[]
}

export interface TeamViewPanelProps {
  /** All reps accessible to the current manager (including themselves). */
  reps: readonly TeamRepSummary[]
}

/**
 * Team View tab (Manager only) — aggregates signals across direct reports
 * with overdue counts and their top 3 urgent actions (Requirement 9.3).
 *
 * Validates: Requirements 9.3
 */
export function TeamViewPanel({ reps }: TeamViewPanelProps): React.JSX.Element {
  const totalOverdue = reps.reduce((n, r) => n + r.overdueCount, 0)

  if (reps.length === 0) {
    return (
      <EmptyState
        title="No team members yet"
        description="Invite users or assign members to your teams to see team signals here."
      />
    )
  }

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
          value={reps.filter((r) => r.overdueCount > 0).length}
        />
      </div>

      <section
        aria-labelledby="team-view-heading"
        className="rounded-md border bg-card"
      >
        <header className="border-b px-4 py-3">
          <h2
            id="team-view-heading"
            className="text-sm font-semibold text-foreground"
          >
            Per-rep signals
          </h2>
        </header>
        <ul className="divide-y">
          {reps.map((rep) => (
            <li key={rep.userId} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-foreground">
                  {rep.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {rep.overdueCount} overdue
                </span>
              </div>
              {rep.topUrgent.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No urgent actions right now.
                </p>
              ) : (
                <ol className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {rep.topUrgent.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-start gap-2 tabular-nums"
                    >
                      <span className="inline-flex w-7 shrink-0 justify-end font-semibold text-foreground">
                        {a.priorityScore}
                      </span>
                      <span className="truncate">{a.title}</span>
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
