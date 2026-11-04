'use client'

import { forecastPeriod } from '@/lib/forecast-period'
import { useActionState, useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { inputBaseClass } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { submitForecast } from '@/server/actions/forecast'
import { MAX_MONEY_AMOUNT } from '@/lib/money'
import { toast } from '@/lib/toast'

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

type ActionResult = {
  error?: string
  fieldErrors?: Record<string, string>
  data?: { id: string }
  uncertain?: boolean
} | null

/**
 * Client form that submits a forecast commit via the
 * `submitForecast` Server Action.
 *
 * The form keeps controlled input values so a failed action preserves the draft.
 * The Server Action validates and persists the submitted values.
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

  const [period, setPeriod] = useState(defaultPeriod ?? currentPeriod())
  const [amount, setAmount] = useState(typeof defaultCommitAmount === 'number' && Number.isFinite(defaultCommitAmount) ? String(defaultCommitAmount) : '')
  const [notes, setNotes] = useState(defaultNotes ?? '')

  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    async (_prev, formData) => {
      try {
        const result = await submitForecast(formData)
        if (result && 'data' in result && result.data) {
          // UI follow-ups cannot invalidate a server-confirmed receipt.
          try {
            toast.success('Forecast submitted')
            onSuccess?.(result.data.id)
          } catch { /* Keep the saved receipt available. */ }
        }
        return result as ActionResult
      } catch {
        return { error: 'Could not confirm the forecast submission. Reload before submitting again.', uncertain: true }
      }
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
          Record expected revenue for your assigned deals, in USD and UTC
          reporting months. Used to compute commit vs AI risk.
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
            value={period}
            onChange={event => setPeriod(event.target.value)}
            aria-invalid={state?.fieldErrors?.period ? true : undefined}
            className={cn(
              inputBaseClass,
              state?.fieldErrors?.period &&
                'border-danger focus-visible:border-danger focus-visible:ring-danger/20',
            )}
            disabled={pending || !canSubmit || state?.uncertain}
          />
          {state?.fieldErrors?.period ? (
            <p role="alert" className="mt-1 text-[11px] text-danger-foreground">
              {state.fieldErrors.period}
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-muted-foreground">
              YYYY-MM format (e.g. 2026-05). Reporting months use UTC.
            </p>
          )}
        </div>
        <div>
          <label
            htmlFor={amountId}
            className="block text-sm font-medium text-foreground mb-1.5"
          >
            Commit amount (USD) <span className="text-danger-foreground">*</span>
          </label>
          <input
            id={amountId}
            name="commitAmount"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            required
            value={amount}
            onChange={event => setAmount(event.target.value)}
            max={MAX_MONEY_AMOUNT}
            placeholder="0.00"
            aria-invalid={state?.fieldErrors?.commitAmount ? true : undefined}
            className={cn(
              inputBaseClass,
              state?.fieldErrors?.commitAmount &&
                'border-danger focus-visible:border-danger focus-visible:ring-danger/20',
            )}
            disabled={pending || !canSubmit || state?.uncertain}
          />
          {state?.fieldErrors?.commitAmount ? (
            <p role="alert" className="mt-1 text-[11px] text-danger-foreground">
              {state.fieldErrors.commitAmount}
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Must be non-negative.
            </p>
          )}
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
          value={notes}
          onChange={event => setNotes(event.target.value)}
          placeholder="Optional context for this commit"
          className={cn(inputBaseClass, 'h-auto min-h-[72px] py-2')}
          disabled={pending || !canSubmit || state?.uncertain}
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

      {state?.uncertain && <a href="/forecast" className="text-sm underline">Reload saved forecast</a>}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !canSubmit || state?.uncertain}>
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

function currentPeriod(): string {
  return forecastPeriod()
}
