'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowDown,
  ArrowUp,
  Loader2,
  Mail,
  Phone,
  Handshake,
  ClipboardList,
  Plus,
  type LucideIcon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { addStep, reorderSteps } from '@/server/actions/cadences'
import type { CadenceStep, StepActionType } from '@/hooks/use-cadences'

/**
 * Cadence step builder — list of steps with actions to add new steps,
 * reorder existing steps, and preview what each step will do.
 *
 * Drag-and-drop reordering is provided via keyboard-accessible up/down
 * buttons on each step rather than pointer-based DnD. This keeps the
 * implementation dependency-free and fully accessible while still meeting
 * the "reorder steps" requirement (6.4, step orders are contiguous integers
 * starting from 1). A proper pointer-drag interaction can be layered on
 * later without changing the server contract.
 *
 * When `readOnly` is set (e.g. the cadence is ARCHIVED) the editor hides
 * the add form and disables the reorder controls.
 *
 * Validates: Requirements 6.4, 6.10, 32.1
 */

export interface CadenceBuilderProps {
  cadenceId: string
  initialSteps: readonly CadenceStep[]
  /**
   * Prevent any step mutation — used when the cadence is ARCHIVED (the
   * server rejects changes anyway; this keeps the UI in lockstep).
   */
  readOnly?: boolean
}

export function CadenceBuilder({
  cadenceId,
  initialSteps,
  readOnly = false,
}: CadenceBuilderProps): React.JSX.Element {
  const router = useRouter()
  const [steps, setSteps] = useState<readonly CadenceStep[]>(() =>
    [...initialSteps].sort((a, b) => a.stepOrder - b.stepOrder),
  )
  const [showAddForm, setShowAddForm] = useState(false)
  const [reorderError, setReorderError] = useState<string | null>(null)
  const [isReordering, startReorder] = useTransition()

  function moveStep(index: number, direction: -1 | 1): void {
    const target = index + direction
    if (target < 0 || target >= steps.length) return
    const next = [...steps]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    setSteps(next)
    setReorderError(null)
    startReorder(async () => {
      const result = await reorderSteps(
        cadenceId,
        next.map((s) => s.id),
      )
      if (result && 'error' in result && result.error) {
        // Revert on error so the server remains the source of truth.
        setSteps([...initialSteps].sort((a, b) => a.stepOrder - b.stepOrder))
        setReorderError(result.error)
        return
      }
      router.refresh()
    })
  }

  function handleStepAdded(newStep: CadenceStep): void {
    setSteps((prev) => [...prev, newStep].sort((a, b) => a.stepOrder - b.stepOrder))
    setShowAddForm(false)
    router.refresh()
  }

  return (
    <section aria-label="Cadence steps" className="flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Steps</h2>
          <p className="text-sm text-muted-foreground">
            {steps.length === 0
              ? 'No steps yet. Add one to get started.'
              : `${steps.length} step${steps.length === 1 ? '' : 's'} in this cadence.`}
          </p>
        </div>
        {!readOnly && !showAddForm && (
          <Button
            type="button"
            size="sm"
            onClick={() => setShowAddForm(true)}
            disabled={isReordering}
          >
            <Plus className="size-4" aria-hidden="true" />
            <span>Add step</span>
          </Button>
        )}
      </header>

      {reorderError ? (
        <p role="alert" className="text-sm text-destructive">
          {reorderError}
        </p>
      ) : null}

      {steps.length === 0 ? (
        <EmptyStepsState readOnly={readOnly} />
      ) : (
        <ol className="flex flex-col gap-2">
          {steps.map((step, index) => (
            <StepRow
              key={step.id}
              step={step}
              index={index}
              total={steps.length}
              onMoveUp={() => moveStep(index, -1)}
              onMoveDown={() => moveStep(index, 1)}
              disabled={readOnly || isReordering}
            />
          ))}
        </ol>
      )}

      {showAddForm && !readOnly && (
        <AddStepForm
          cadenceId={cadenceId}
          onAdded={handleStepAdded}
          onCancel={() => setShowAddForm(false)}
        />
      )}
    </section>
  )
}

function EmptyStepsState({ readOnly }: { readOnly: boolean }): React.JSX.Element {
  return (
    <div className="flex flex-col items-start gap-2 rounded-md border border-dashed bg-card px-4 py-6 text-sm">
      <p className="text-muted-foreground">
        A cadence needs at least one step before it can be activated.
      </p>
      {readOnly ? (
        <p className="text-xs text-muted-foreground">
          This cadence is archived and cannot be modified.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Use <span className="font-medium">Add step</span> above to add an
          email, call, LinkedIn, or manual task step.
        </p>
      )}
    </div>
  )
}

interface StepRowProps {
  step: CadenceStep
  index: number
  total: number
  onMoveUp: () => void
  onMoveDown: () => void
  disabled: boolean
}

function StepRow({
  step,
  index,
  total,
  onMoveUp,
  onMoveDown,
  disabled,
}: StepRowProps): React.JSX.Element {
  const Icon = stepIcon(step.actionType)
  return (
    <li className="flex items-start gap-3 rounded-md border bg-card p-3">
      <span
        aria-hidden="true"
        className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground"
      >
        {step.stepOrder}
      </span>
      <div className="flex-1">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
          <span>{actionTypeLabel(step.actionType)}</span>
          <span className="text-xs font-normal text-muted-foreground">
            · {describeDelay(step.delayHours)}
          </span>
        </div>
        {renderStepDetails(step)}
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon-xs"
          onClick={onMoveUp}
          disabled={disabled || index === 0}
          aria-label={`Move step ${step.stepOrder} up`}
        >
          <ArrowUp className="size-3" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-xs"
          onClick={onMoveDown}
          disabled={disabled || index === total - 1}
          aria-label={`Move step ${step.stepOrder} down`}
        >
          <ArrowDown className="size-3" aria-hidden="true" />
        </Button>
      </div>
    </li>
  )
}

function renderStepDetails(step: CadenceStep): React.JSX.Element | null {
  if (step.actionType === 'EMAIL') {
    return (
      <div className="mt-1 text-sm">
        {step.emailSubject ? (
          <div className="font-medium text-foreground">
            {step.emailSubject}
          </div>
        ) : null}
        {step.emailBody ? (
          <p className="line-clamp-2 text-muted-foreground">{step.emailBody}</p>
        ) : (
          <p className="text-xs italic text-muted-foreground">
            No body configured yet.
          </p>
        )}
      </div>
    )
  }
  if (step.taskTitle) {
    return (
      <p className="mt-1 text-sm text-muted-foreground">{step.taskTitle}</p>
    )
  }
  return null
}

function stepIcon(type: StepActionType): LucideIcon {
  switch (type) {
    case 'EMAIL':
      return Mail
    case 'CALL':
      return Phone
    case 'LINKEDIN':
      return Handshake
    case 'MANUAL_TASK':
      return ClipboardList
  }
}

function actionTypeLabel(type: StepActionType): string {
  switch (type) {
    case 'EMAIL':
      return 'Email'
    case 'CALL':
      return 'Call'
    case 'LINKEDIN':
      return 'LinkedIn'
    case 'MANUAL_TASK':
      return 'Manual task'
  }
}

function describeDelay(hours: number): string {
  if (hours <= 0) return 'Immediately'
  if (hours < 24) return `Wait ${hours}h`
  const days = Math.round(hours / 24)
  return `Wait ${days}d`
}

// ─── Add-step form ───────────────────────────────────────────────────────────

interface AddStepFormProps {
  cadenceId: string
  onAdded: (step: CadenceStep) => void
  onCancel: () => void
}

function AddStepForm({
  cadenceId,
  onAdded,
  onCancel,
}: AddStepFormProps): React.JSX.Element {
  const [actionType, setActionType] = useState<StepActionType>('EMAIL')
  const [error, setError] = useState<string | null>(null)
  const [pending, startSubmit] = useTransition()

  const actionOptions = useMemo(
    () =>
      (
        [
          { value: 'EMAIL', label: 'Email' },
          { value: 'CALL', label: 'Call' },
          { value: 'LINKEDIN', label: 'LinkedIn' },
          { value: 'MANUAL_TASK', label: 'Manual task' },
        ] as const
      ),
    [],
  )

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    setError(null)
    const form = event.currentTarget
    const formData = new FormData(form)
    formData.set('cadenceId', cadenceId)
    formData.set('actionType', actionType)
    startSubmit(async () => {
      const result = await addStep(formData)
      if (result && 'error' in result && result.error) {
        setError(result.error)
        return
      }
      if (result && 'data' in result && result.data) {
        const raw = result.data as unknown as {
          id: string
          cadenceId: string
          stepOrder: number
          actionType: string
          delayHours: number
          emailSubject: string | null
          emailBody: string | null
          taskTitle: string | null
          taskDescription: string | null
          createdAt: Date | string
          updatedAt: Date | string
        }
        const serialized: CadenceStep = {
          id: raw.id,
          cadenceId: raw.cadenceId,
          stepOrder: raw.stepOrder,
          actionType: raw.actionType as StepActionType,
          delayHours: raw.delayHours,
          emailSubject: raw.emailSubject,
          emailBody: raw.emailBody,
          taskTitle: raw.taskTitle,
          taskDescription: raw.taskDescription,
          createdAt: raw.createdAt instanceof Date
            ? raw.createdAt.toISOString()
            : raw.createdAt,
          updatedAt: raw.updatedAt instanceof Date
            ? raw.updatedAt.toISOString()
            : raw.updatedAt,
        }
        onAdded(serialized)
      }
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-md border bg-card p-4"
      aria-busy={pending || undefined}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label
            htmlFor="step-action-type"
            className="block text-xs font-medium text-foreground mb-1"
          >
            Action type
          </label>
          <select
            id="step-action-type"
            name="actionType"
            value={actionType}
            onChange={(e) => setActionType(e.target.value as StepActionType)}
            className={inputClasses}
          >
            {actionOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="step-delay-hours"
            className="block text-xs font-medium text-foreground mb-1"
          >
            Delay (hours)
          </label>
          <input
            id="step-delay-hours"
            name="delayHours"
            type="number"
            min={0}
            step={1}
            defaultValue={0}
            className={inputClasses}
          />
        </div>
      </div>

      {actionType === 'EMAIL' ? (
        <>
          <div>
            <label
              htmlFor="step-subject"
              className="block text-xs font-medium text-foreground mb-1"
            >
              Subject
            </label>
            <input
              id="step-subject"
              name="subject"
              type="text"
              placeholder="Use {{FirstName}}, {{CompanyName}} for personalization"
              className={inputClasses}
            />
          </div>
          <div>
            <label
              htmlFor="step-body"
              className="block text-xs font-medium text-foreground mb-1"
            >
              Body
            </label>
            <textarea
              id="step-body"
              name="body"
              rows={5}
              placeholder="Email body…"
              className={cn(
                'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
            />
          </div>
        </>
      ) : (
        <div>
          <label
            htmlFor="step-instructions"
            className="block text-xs font-medium text-foreground mb-1"
          >
            Instructions
          </label>
          <textarea
            id="step-instructions"
            name="instructions"
            rows={4}
            placeholder="What should the rep do for this step?"
            className={cn(
              'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          />
        </div>
      )}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              <span>Adding…</span>
            </>
          ) : (
            <span>Add step</span>
          )}
        </Button>
      </div>
    </form>
  )
}

const inputClasses =
  'flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'
