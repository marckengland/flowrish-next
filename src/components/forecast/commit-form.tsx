'use client'

import { useActionState, useId } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { submitForecast } from '@/server/actions/forecast'

export interface CommitFormProps {
  /** YYYY-MM period to pre-select (defaults to the current month). */
  defaultPeriod?: string
  /** Pre-fill commit amount from the last submission, if any. */
  defaultCommitAmount?: number | null
  /** Pre-fill notes from the last submission, if any. */
  defaultNotes?: string | null
  /** Whether the user is allowed to submit (gated by `forecast:submit`). */
  canSubmit?: boolean
  /** Optional callback invoked after a successful submission. */
  onSuccess?: (submissionId: string) => void
}

type ActionResult = { error?: string; data?: { id: string } } | null

/**
 * Client form that submits a forecast commit via the
 * `submitForecast` Server Action.
 *
 * The form is deliberately uncontrolled — the browser owns the input
 * state while the Server Action owns validation and persistence.
 * Uses React 19 `useActionState` so the pending/error UI stays in
 * sync with the action's lifecycle without a TanStack mutation.
 *
 * Validates: Requirement 10.2
 */
export function CommitForm({
  defaultPeriod,
  defaultCommitAmount,
  defaultNotes,
  canSubmit = true,
  onSuccess,
}: CommitFormProps): React.JSX.Element {
  const periodId = useId()
  const amountId = useId()
  const notesId = useId()

  const resolvedPeriod = defaultPeriod ?? currentPeriod()

  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    async (_prev, formData) => {
      const result = await submitForecast(formData)
      if (result && 'data' in result && result.data) {
        onSuccess?.(result.data.id)
      }
      return result as ActionResult
    },
    null,
  )

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-lg border bg-card p-5"
      aria-busy={pending || undefined}
    >
      <div>
        <h2 className="text-sm font-semibold text-foreground">
          Submit forecast commit
        </h2>
        <p className="text-xs text-muted-foreground">
          Record your expected revenue for the period. Used to compute
          commit vs AI risk.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label
            htmlFor={periodId}
            className="block text-sm font-medium text-foreground mb-1.5"
          >
            Period <span className="text-danger-foreground">*</span>
          </label>
          <input
            id={periodId}
            name="period"
            type="month"
            required
            defaultValue={resolvedPeriod}
            className={inputClass}
            disabled={!canSubmit}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            YYYY-MM format (e.g. 2026-05).
          </p>
        </div>
        <div>
          <label
            htmlFor={amountId}
            className="block text-sm font-medium text-foreground mb-1.5"
          >
            Commit amount <span className="text-danger-foreground">*</span>
          </label>
          <input
            id={amountId}
            name="commitAmount"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            required
            defaultValue={
              typeof defaultCommitAmount === 'number' &&
              Number.isFinite(defaultCommitAmount)
                ? String(defaultCommitAmount)
                : ''
            }
            placeholder="0.00"
            className={inputClass}
            disabled={!canSubmit}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Must be non-negative.
          </p>
        </div>
      </div>

      <div>
        <label
          htmlFor={notesId}
          className="block text-sm font-medium text-foreground mb-1.5"
        >
          Notes
        </label>
        <textarea
          id={notesId}
          name="notes"
          rows={3}
          defaultValue={defaultNotes ?? ''}
          placeholder="Optional context for this commit"
          className={cn(
            inputClass,
            'h-auto min-h-[72px] py-2',
          )}
          disabled={!canSubmit}
        />
      </div>

      {state?.error ? (
        <p role="alert" className="text-sm text-danger-foreground">
          {state.error}
        </p>
      ) : null}
      {state && 'data' in state && state.data ? (
        <p role="status" className="text-sm text-brand-emphasis">
          Forecast submitted.
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !canSubmit}>
          {pending ? 'Submitting…' : 'Submit forecast'}
        </Button>
      </div>
      {!canSubmit ? (
        <p className="text-xs text-muted-foreground">
          You don&apos;t have permission to submit a forecast.
        </p>
      ) : null}
    </form>
  )
}

const inputClass =
  'flex h-9 w-full rounded-[10px] border border-input bg-card px-3 py-1 text-sm text-foreground shadow-sm transition-[color,box-shadow,border-color] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand/15 disabled:cursor-not-allowed disabled:opacity-50'

function currentPeriod(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}
