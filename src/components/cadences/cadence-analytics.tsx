'use client'

import { useMemo } from 'react'
import {
  Activity as ActivityIcon,
  Users,
  CheckCircle2,
  LogOut,
  Pause,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  useCadenceAnalyticsQuery,
  type CadenceAnalytics,
  type CadenceStep,
  type EnrollmentListItem,
} from '@/hooks/use-cadences'

/**
 * Cadence analytics panel — enrollment counts, completion rate, and
 * per-step progression metrics.
 *
 * Top-line metrics (total / active / completed / exited / paused) come
 * from the `/api/cadences/[id]/analytics` endpoint via TanStack Query so
 * they stay in sync with enrollment actions performed elsewhere on the
 * page.
 *
 * Per-step metrics (reached / completed / exited) are computed client-side
 * from the enrollment list provided by the Server Component. A lead at
 * `currentStepOrder = N` has "reached" every step with `stepOrder <= N`.
 * "Completed" at step N is the number of leads whose `currentStepOrder`
 * has moved past N (or whose enrollment is COMPLETED). "Exited" at step
 * N is the number of EXITED enrollments whose `currentStepOrder` equals N.
 * This is an approximation suitable for the Overview tab — a richer
 * per-step breakdown lives server-side in task 8.3 analytics.
 *
 * Validates: Requirements 32.1, 32.5
 */

export interface CadenceAnalyticsPanelProps {
  cadenceId: string
  initialAnalytics: CadenceAnalytics
  steps: readonly CadenceStep[]
  enrollments: readonly EnrollmentListItem[]
}

export function CadenceAnalyticsPanel({
  cadenceId,
  initialAnalytics,
  steps,
  enrollments,
}: CadenceAnalyticsPanelProps): React.JSX.Element {
  const analyticsQuery = useCadenceAnalyticsQuery(cadenceId, initialAnalytics)
  const analytics = analyticsQuery.data ?? initialAnalytics

  const perStep = useMemo(
    () => computePerStepMetrics(steps, enrollments),
    [steps, enrollments],
  )

  return (
    <section aria-label="Cadence analytics" className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <MetricTile
          icon={Users}
          label="Total enrolled"
          value={analytics.totalEnrollments}
        />
        <MetricTile
          icon={ActivityIcon}
          label="Active"
          value={analytics.activeEnrollments}
          tone="emerald"
        />
        <MetricTile
          icon={Pause}
          label="Paused"
          value={analytics.pausedEnrollments}
          tone="amber"
        />
        <MetricTile
          icon={CheckCircle2}
          label="Completed"
          value={analytics.completedEnrollments}
          tone="blue"
        />
        <MetricTile
          icon={LogOut}
          label="Exited"
          value={analytics.exitedEnrollments}
        />
      </div>

      <div className="rounded-md border bg-card p-4">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold">Completion rate</h3>
          <span className="text-2xl font-semibold tabular-nums">
            {analytics.completionRate}%
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Share of terminal enrollments (completed or exited) that completed
          successfully.
        </p>
        <div
          className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={analytics.completionRate}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Completion rate"
        >
          <div
            className="h-full rounded-full bg-brand transition-[width]"
            style={{ width: `${Math.min(100, Math.max(0, analytics.completionRate))}%` }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Per-step metrics</h3>
        {steps.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add at least one step to see per-step metrics.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border bg-card">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Step
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Type
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Reached
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Completed
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Exited
                  </th>
                </tr>
              </thead>
              <tbody>
                {perStep.map((row) => (
                  <tr key={row.stepId} className="border-t">
                    <td className="px-3 py-2">Step {row.stepOrder}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.actionType}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.reached}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.completed}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.exited}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

interface MetricTileProps {
  icon: typeof Users
  label: string
  value: number
  tone?: 'emerald' | 'amber' | 'blue'
}

function MetricTile({
  icon: Icon,
  label,
  value,
  tone,
}: MetricTileProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1 rounded-md border bg-card p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon
          className={cn(
            'size-4',
            tone === 'emerald' && 'text-brand',
            tone === 'amber' && 'text-warning-foreground',
            tone === 'blue' && 'text-ai',
          )}
          aria-hidden="true"
        />
        <span>{label}</span>
      </div>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
    </div>
  )
}

// ─── Per-step metrics ────────────────────────────────────────────────────────

export interface PerStepMetric {
  stepId: string
  stepOrder: number
  actionType: string
  reached: number
  completed: number
  exited: number
}

/**
 * Pure function exported for test coverage. Given the ordered list of
 * steps and the current enrollments, returns a per-step summary:
 *
 * - `reached`: enrollments whose `currentStepOrder >= stepOrder`, plus
 *   enrollments that have already COMPLETED (they reached every step).
 * - `completed`: enrollments whose `currentStepOrder > stepOrder`, plus
 *   COMPLETED enrollments.
 * - `exited`: EXITED enrollments whose `currentStepOrder == stepOrder`.
 */
export function computePerStepMetrics(
  steps: readonly CadenceStep[],
  enrollments: readonly EnrollmentListItem[],
): PerStepMetric[] {
  return [...steps]
    .sort((a, b) => a.stepOrder - b.stepOrder)
    .map((step) => {
      let reached = 0
      let completed = 0
      let exited = 0
      for (const e of enrollments) {
        if (e.status === 'COMPLETED') {
          reached += 1
          completed += 1
          continue
        }
        if (e.currentStepOrder >= step.stepOrder) {
          reached += 1
        }
        if (e.currentStepOrder > step.stepOrder) {
          completed += 1
        }
        if (e.status === 'EXITED' && e.currentStepOrder === step.stepOrder) {
          exited += 1
        }
      }
      return {
        stepId: step.id,
        stepOrder: step.stepOrder,
        actionType: step.actionType,
        reached,
        completed,
        exited,
      }
    })
}
