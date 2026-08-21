'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Pause, Play, LogOut } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableHead, Th, TableBody, Tr, Td, TableState } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import {
  pauseEnrollment,
  resumeEnrollment,
  exitEnrollment,
} from '@/server/actions/cadences'
import type { EnrollmentListItem, EnrollmentStatus } from '@/hooks/use-cadences'

/**
 * Enrollment list — shows leads enrolled in a cadence with per-row
 * pause/resume/exit actions. The initial rows are provided by the Server
 * Component so the table paints immediately. Mutations call Server Actions
 * (which do audit logging and `revalidatePath('/cadences')`) and then
 * `router.refresh()` so the server-side list re-renders with the new state.
 *
 * Validates: Requirements 6.5, 6.6, 32.1, 32.2, 32.3
 */

export interface EnrollmentListProps {
  initialEnrollments: readonly EnrollmentListItem[]
}

type StatusFilter = 'ALL' | EnrollmentStatus

const STATUS_FILTERS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'PAUSED', label: 'Paused' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'EXITED', label: 'Exited' },
]

export function EnrollmentList({
  initialEnrollments,
}: EnrollmentListProps): React.JSX.Element {
  const [filter, setFilter] = useState<StatusFilter>('ALL')
  const [actionError, setActionError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const filtered =
    filter === 'ALL'
      ? initialEnrollments
      : initialEnrollments.filter((e) => e.status === filter)

  function runAction(
    enrollmentId: string,
    action: 'pause' | 'resume' | 'exit',
  ): void {
    setActionError(null)
    setPendingId(enrollmentId)
    startTransition(async () => {
      let result: { error?: string } | undefined
      if (action === 'pause') {
        result = await pauseEnrollment(enrollmentId)
      } else if (action === 'resume') {
        result = await resumeEnrollment(enrollmentId)
      } else {
        // Exit uses the "manual" reason when triggered from the UI.
        result = await exitEnrollment(enrollmentId, 'manual')
      }
      setPendingId(null)
      if (result && 'error' in result && result.error) {
        setActionError(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <section aria-label="Enrollments" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">People</h2>
          <p className="text-sm text-muted-foreground">
            {initialEnrollments.length} lead
            {initialEnrollments.length === 1 ? '' : 's'} enrolled
          </p>
        </div>
        <div
          role="tablist"
          aria-label="Filter enrollments by status"
          className="flex flex-wrap gap-1"
        >
          {STATUS_FILTERS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={filter === opt.value}
              onClick={() => setFilter(opt.value)}
              className={cn(
                'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                filter === opt.value
                  ? 'border-border bg-card text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {actionError ? (
        <p role="alert" className="text-sm text-danger-foreground">
          {actionError}
        </p>
      ) : null}

      <Table minWidth={720}>
        <TableHead>
          <Th>Lead</Th>
          <Th>Status</Th>
          <Th>Step</Th>
          <Th>Enrolled</Th>
          <Th align="right">Actions</Th>
        </TableHead>
        <TableBody>
          {filtered.length === 0 ? (
            <TableState
              colSpan={5}
              title={
                initialEnrollments.length === 0
                  ? 'No leads enrolled yet'
                  : 'No enrollments match this filter'
              }
              description={
                initialEnrollments.length === 0
                  ? 'Enroll leads from the cadence to start working them.'
                  : 'Try a different status filter.'
              }
            />
          ) : (
            filtered.map((enrollment) => {
              const pending = isPending && pendingId === enrollment.id
              return (
                <Tr key={enrollment.id}>
                    <Td>
                      {enrollment.lead ? (
                        <Link
                          href={`/leads/${enrollment.lead.id}`}
                          className="font-medium text-foreground hover:underline"
                        >
                          {leadDisplayName(enrollment.lead)}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">
                          Lead {enrollment.leadId.slice(0, 8)}
                        </span>
                      )}
                      {enrollment.lead?.companyName ? (
                        <div className="text-xs text-muted-foreground">
                          {enrollment.lead.companyName}
                        </div>
                      ) : null}
                    </Td>
                    <Td>
                      <StatusBadge status={enrollment.status} />
                      {enrollment.status === 'EXITED' && enrollment.exitReason ? (
                        <div className="text-xs text-muted-foreground">
                          {formatExitReason(enrollment.exitReason)}
                        </div>
                      ) : null}
                    </Td>
                    <Td className="text-muted-foreground">
                      Step {enrollment.currentStepOrder}
                    </Td>
                    <Td className="text-muted-foreground" suppressHydrationWarning>
                      {formatRelative(enrollment.enrolledAt)}
                    </Td>
                    <Td align="right">
                      <div className="flex justify-end gap-1">
                        {enrollment.status === 'ACTIVE' && (
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            onClick={() => runAction(enrollment.id, 'pause')}
                            disabled={pending}
                            aria-label="Pause enrollment"
                          >
                            {pending ? (
                              <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                            ) : (
                              <Pause className="size-3" aria-hidden="true" />
                            )}
                            <span>Pause</span>
                          </Button>
                        )}
                        {enrollment.status === 'PAUSED' && (
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            onClick={() => runAction(enrollment.id, 'resume')}
                            disabled={pending}
                            aria-label="Resume enrollment"
                          >
                            {pending ? (
                              <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                            ) : (
                              <Play className="size-3" aria-hidden="true" />
                            )}
                            <span>Resume</span>
                          </Button>
                        )}
                        {(enrollment.status === 'ACTIVE'
                          || enrollment.status === 'PAUSED') && (
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            onClick={() => runAction(enrollment.id, 'exit')}
                            disabled={pending}
                            aria-label="Exit enrollment"
                          >
                            <LogOut className="size-3" aria-hidden="true" />
                            <span>Exit</span>
                          </Button>
                        )}
                      </div>
                    </Td>
                  </Tr>
                )
              })
            )}
          </TableBody>
        </Table>
    </section>
  )
}

function StatusBadge({ status }: { status: EnrollmentStatus }): React.JSX.Element {
  const variant: Record<
    EnrollmentStatus,
    'brand' | 'warning' | 'ai' | 'neutral'
  > = {
    ACTIVE: 'brand',
    PAUSED: 'warning',
    COMPLETED: 'ai',
    EXITED: 'neutral',
  }
  return <Badge variant={variant[status]}>{formatStatus(status)}</Badge>
}

function formatStatus(status: EnrollmentStatus): string {
  return status.charAt(0) + status.slice(1).toLowerCase()
}

function formatExitReason(reason: string): string {
  return reason.split('_').map(capitalize).join(' ')
}

function capitalize(word: string): string {
  if (word.length === 0) return word
  return word.charAt(0).toUpperCase() + word.slice(1)
}

function leadDisplayName(
  lead: NonNullable<EnrollmentListItem['lead']>,
): string {
  const parts = [lead.firstName, lead.lastName].filter(Boolean)
  return parts.join(' ').trim() || lead.email || 'Unnamed lead'
}

function formatRelative(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const diffMs = Date.now() - d.getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return d.toLocaleDateString()
}
