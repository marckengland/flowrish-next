'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Loader2, Lock } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface StageOption {
  id: string
  name: string
  order: number
  isClosedWon: boolean
  isClosedLost: boolean
}

export interface LeadStageTransitionProps {
  leadId: string
  currentStageId: string
  /** Stages from the lead's pipeline, sorted by `order`. */
  stages: readonly StageOption[]
  /** Whether the current user can move the lead. */
  canEdit?: boolean
}

/**
 * Stage transition surface — renders the pipeline progression as a row
 * of breadcrumb-style chips with the current stage highlighted, and
 * offers a target-stage selector + "Move" button for valid transitions.
 *
 * Closed stages (`isClosedWon` or `isClosedLost`) are marked with a lock
 * icon. When the lead is already in a terminal stage, the helper text
 * makes it clear the lead can be reopened by moving back to an open
 * stage.
 *
 * The actual move call goes to `PATCH /api/leads/[id]/move`, which
 * delegates to the `moveLead` service that records a StageTransition
 * row and toggles `isClosed`/`closeDate` according to the target stage.
 *
 * Validates: Requirements 29.1, 29.2, 29.3, 34.3
 */
export function LeadStageTransition({
  leadId,
  currentStageId,
  stages,
  canEdit = true,
}: LeadStageTransitionProps): React.JSX.Element {
  const router = useRouter()
  const [target, setTarget] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const ordered = [...stages].sort((a, b) => a.order - b.order)
  const current = ordered.find((s) => s.id === currentStageId)
  const others = ordered.filter((s) => s.id !== currentStageId)
  const currentlyClosed = Boolean(
    current && (current.isClosedWon || current.isClosedLost),
  )

  function move(): void {
    if (!target) return
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/leads/${leadId}/move`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          credentials: 'same-origin',
          body: JSON.stringify({ toStageId: target }),
        })
        if (!res.ok) {
          let message = `Failed to move lead (${res.status})`
          try {
            const body = (await res.json()) as { error?: { message?: string } }
            if (body.error?.message) message = body.error.message
          } catch {
            // ignore parse failure
          }
          setError(message)
          return
        }
        setTarget('')
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to move lead.')
      }
    })
  }

  return (
    <section
      aria-label="Move stage"
      className="flex flex-col gap-3 rounded-md border bg-card p-4"
    >
      <h3 className="text-sm font-semibold">Move stage</h3>

      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {ordered.map((stage, index) => {
          const closed = stage.isClosedWon || stage.isClosedLost
          const isCurrent = stage.id === currentStageId
          return (
            <div key={stage.id} className="flex items-center">
              <span
                className={cn(
                  'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium',
                  isCurrent
                    ? 'bg-primary text-primary-foreground'
                    : closed
                      ? 'bg-muted text-muted-foreground'
                      : 'bg-muted/60 text-muted-foreground',
                )}
              >
                {closed ? <Lock className="size-3" aria-hidden="true" /> : null}
                {stage.name}
              </span>
              {index < ordered.length - 1 ? (
                <ArrowRight
                  className="mx-0.5 size-3 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              ) : null}
            </div>
          )
        })}
      </div>

      {currentlyClosed ? (
        <p className="text-xs text-muted-foreground">
          This lead is closed ({current!.name}). Reopen by moving to an open
          stage.
        </p>
      ) : null}

      {canEdit ? (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label
              htmlFor="stage-transition-select"
              className="mb-1 block text-xs text-muted-foreground"
            >
              Target stage
            </label>
            <select
              id="stage-transition-select"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              disabled={pending}
              className="h-9 w-full rounded-lg border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">Select stage…</option>
              {others.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.isClosedWon || s.isClosedLost ? ' (Closed)' : ''}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={move}
            disabled={!target || pending}
          >
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                <span>Moving…</span>
              </>
            ) : (
              <span>Move</span>
            )}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          You don&apos;t have permission to move this lead.
        </p>
      )}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  )
}
