import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/dashboard/metric-card'
import { ScoreCircle } from '@/components/scoring/score-badge'

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

// Deal value at or above this threshold earns a "HIGH VALUE" signal chip.
const HIGH_VALUE_THRESHOLD = 100_000

/**
 * Rhythm priority queue — the primary surface of the rhythm dashboard.
 *
 * A single card of divided rows ranked by priority score. Each row shows
 * a band-colored score circle, the action title, a muted
 * "lead · value" subline, and signal chips (overdue, due today, high
 * priority, high value) that explain why the action is ranked where it
 * is. Each row deep-links to the parent lead.
 *
 * Validates: Requirements 9.1, 9.2
 */
export function PriorityList({ actions }: PriorityListProps): React.JSX.Element {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Priority queue</CardTitle>
        <span className="eyebrow tnum">{actions.length} open</span>
      </CardHeader>
      {actions.length === 0 ? (
        <EmptyState
          title="Nothing to do right now"
          description="New actions will be ranked and surfaced here automatically."
          className="m-[18px] border-0"
        />
      ) : (
        <ul aria-label="Prioritized actions" className="divide-y divide-row-divider">
          {actions.map((action) => (
            <li key={action.id} className="relative transition-colors hover:bg-background">
              <div className="flex items-start gap-[13px] px-[18px] py-3.5">
                <ScoreCircle score={action.priorityScore} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold text-foreground">
                    <Link
                      href={`/leads/${action.leadId}`}
                      className="before:absolute before:inset-0 before:content-[''] focus-visible:underline focus-visible:outline-none"
                    >
                      {action.title}
                    </Link>
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    <span className="truncate">{action.leadName}</span>
                    {action.dealValue != null ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="tnum">
                          {formatCurrency(action.dealValue, action.currency)}
                        </span>
                      </>
                    ) : null}
                  </p>
                  <GapChips action={action} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/**
 * Signal chips that surface why an action sits where it does in the
 * queue. Rectangular mono badges matching the redesign's gap-chip style.
 */
function GapChips({ action }: { action: PriorityActionRow }): React.JSX.Element | null {
  const chips: React.ReactNode[] = []

  if (action.isOverdue) {
    const days = daysOverdue(action.dueDate)
    chips.push(
      <Badge key="overdue" variant="danger" size="sm" className="rounded-[5px] font-mono">
        {days > 0 ? `OVERDUE ${days}D` : 'OVERDUE'}
      </Badge>,
    )
  } else if (isSameDay(action.dueDate, new Date())) {
    chips.push(
      <Badge key="due-today" variant="warning" size="sm" className="rounded-[5px] font-mono">
        DUE TODAY
      </Badge>,
    )
  }

  if (action.priority === 'HIGH') {
    chips.push(
      <Badge key="high-priority" variant="neutral" size="sm" className="rounded-[5px] font-mono">
        HIGH PRIORITY
      </Badge>,
    )
  }

  if (action.dealValue != null && action.dealValue >= HIGH_VALUE_THRESHOLD) {
    chips.push(
      <Badge key="high-value" variant="neutral" size="sm" className="rounded-[5px] font-mono">
        HIGH VALUE
      </Badge>,
    )
  }

  if (chips.length === 0) return null

  return <div className="mt-2 flex flex-wrap gap-1.5">{chips}</div>
}

function daysOverdue(input: Date | string): number {
  const d = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(d.getTime())) return 0
  const diffMs = Date.now() - d.getTime()
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)))
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
  if (Number.isNaN(d.getTime())) return false
  return (
    d.getFullYear() === reference.getFullYear() &&
    d.getMonth() === reference.getMonth() &&
    d.getDate() === reference.getDate()
  )
}
