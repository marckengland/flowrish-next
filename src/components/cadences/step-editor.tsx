'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  ClipboardList,
  Handshake,
  Loader2,
  Mail,
  Phone,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { HelpTooltip } from '@/components/ui/help-tooltip'
import { RichTextEditor } from '@/components/email/rich-text-editor'
import { addStep, deleteStep, updateStep } from '@/server/actions/cadences'
import { cn } from '@/lib/utils'
import type { CadenceStep, StepActionType } from '@/hooks/use-cadences'

/**
 * Modal step editor — used both for adding a new step and editing or
 * deleting an existing one. Mirrors the original flowrish StepEditor
 * surface but speaks to the Server Actions added in this round of work.
 */

const ACTION_TYPES: ReadonlyArray<{
  value: StepActionType
  label: string
  description: string
  icon: LucideIcon
  /** Card styling when the action is selected. */
  activeClass: string
}> = [
  {
    value: 'EMAIL',
    label: 'Email',
    description: 'Send an automated email',
    icon: Mail,
    activeClass:
      'border-purple-300 bg-purple-100 text-purple-700 dark:border-purple-700 dark:bg-purple-900/40 dark:text-purple-200',
  },
  {
    value: 'CALL',
    label: 'Phone',
    description: 'Schedule a call task',
    icon: Phone,
    activeClass:
      'border-blue-300 bg-blue-100 text-blue-700 dark:border-blue-700 dark:bg-blue-900/40 dark:text-blue-200',
  },
  {
    value: 'LINKEDIN',
    label: 'LinkedIn',
    description: 'Send a connection request',
    icon: Handshake,
    activeClass:
      'border-sky-300 bg-sky-100 text-sky-700 dark:border-sky-700 dark:bg-sky-900/40 dark:text-sky-200',
  },
  {
    value: 'MANUAL_TASK',
    label: 'Other',
    description: 'Create a manual task',
    icon: ClipboardList,
    activeClass:
      'border-orange-300 bg-orange-100 text-orange-700 dark:border-orange-700 dark:bg-orange-900/40 dark:text-orange-200',
  },
]

type DelayUnit = 'hours' | 'days'

export interface StepEditorProps {
  cadenceId: string
  /** When provided, the dialog is in "edit" mode. */
  step?: CadenceStep | null
  canEdit: boolean
  canDelete: boolean
  onClose: () => void
  /** Called with the new/updated step so callers can update local state. */
  onSaved?: (step: CadenceStep) => void
  /** Called after a successful delete so callers can update local state. */
  onDeleted?: (stepId: string) => void
}

export function StepEditor({
  cadenceId,
  step,
  canEdit,
  canDelete,
  onClose,
  onSaved,
  onDeleted,
}: StepEditorProps): React.JSX.Element {
  const router = useRouter()
  const isNew = !step

  const [actionType, setActionType] = useState<StepActionType>(
    step?.actionType ?? 'EMAIL',
  )
  const [delayUnit, setDelayUnit] = useState<DelayUnit>(() => {
    const h = step?.delayHours ?? 0
    return h > 0 && h % 24 === 0 ? 'days' : 'hours'
  })
  const [delayValue, setDelayValue] = useState<number>(() => {
    const h = step?.delayHours ?? 0
    return h > 0 && h % 24 === 0 ? h / 24 : h
  })
  const [emailSubject, setEmailSubject] = useState(step?.emailSubject ?? '')
  const [emailBody, setEmailBody] = useState(step?.emailBody ?? '')
  const [taskTitle, setTaskTitle] = useState(step?.taskTitle ?? '')
  const [taskDescription, setTaskDescription] = useState(
    step?.taskDescription ?? '',
  )
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pending, startTransition] = useTransition()

  // Re-sync local state if the parent swaps which step is being edited
  // without unmounting the modal.
  useEffect(() => {
    if (!step) return
    setActionType(step.actionType)
    const h = step.delayHours
    if (h > 0 && h % 24 === 0) {
      setDelayUnit('days')
      setDelayValue(h / 24)
    } else {
      setDelayUnit('hours')
      setDelayValue(h)
    }
    setEmailSubject(step.emailSubject ?? '')
    setEmailBody(step.emailBody ?? '')
    setTaskTitle(step.taskTitle ?? '')
    setTaskDescription(step.taskDescription ?? '')
  }, [step])

  // Close on Escape so the dialog behaves like a real modal.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const delayHours = delayUnit === 'days' ? delayValue * 24 : delayValue

  function save(): void {
    setError(null)
    startTransition(async () => {
      if (isNew) {
        const formData = new FormData()
        formData.set('cadenceId', cadenceId)
        formData.set('actionType', actionType)
        formData.set('delayHours', String(delayHours))
        if (actionType === 'EMAIL') {
          formData.set('subject', emailSubject)
          formData.set('body', emailBody)
        } else {
          formData.set('taskTitle', taskTitle)
          formData.set('taskDescription', taskDescription)
        }
        const result = await addStep(formData)
        if (result && 'error' in result && result.error) {
          setError(result.error)
          return
        }
        if (result && 'data' in result && result.data) {
          onSaved?.(serializeStep(result.data))
        }
        onClose()
        router.refresh()
        return
      }

      // Edit mode — diff against the original step so we only send
      // patched fields. Ensures the validator's "at least one field"
      // refinement is satisfied with a meaningful change.
      const patch: Parameters<typeof updateStep>[2] = {}
      if (actionType !== step!.actionType) patch.actionType = actionType
      if (delayHours !== step!.delayHours) patch.delayHours = delayHours
      if (actionType === 'EMAIL') {
        if (emailSubject !== (step!.emailSubject ?? '')) {
          patch.subject = emailSubject || null
        }
        if (emailBody !== (step!.emailBody ?? '')) {
          patch.body = emailBody || null
        }
      } else {
        if (taskTitle !== (step!.taskTitle ?? '')) {
          patch.taskTitle = taskTitle || null
        }
        if (taskDescription !== (step!.taskDescription ?? '')) {
          patch.taskDescription = taskDescription || null
        }
      }

      if (Object.keys(patch).length === 0) {
        // Nothing changed — just close without making a request.
        onClose()
        return
      }

      const result = await updateStep(cadenceId, step!.id, patch)
      if (result && 'error' in result && result.error) {
        setError(result.error)
        return
      }
      if (result && 'data' in result && result.data) {
        onSaved?.(serializeStep(result.data))
      }
      onClose()
      router.refresh()
    })
  }

  function runDelete(): void {
    if (!step) return
    setError(null)
    startTransition(async () => {
      const result = await deleteStep(cadenceId, step.id)
      if (result && 'error' in result && result.error) {
        setError(result.error)
        return
      }
      onDeleted?.(step.id)
      onClose()
      router.refresh()
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="step-editor-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border bg-background shadow-lg">
        <header className="flex shrink-0 items-center justify-between border-b px-5 py-3">
          <h3 id="step-editor-title" className="text-base font-semibold">
            {isNew ? 'Add step' : `Edit step ${step!.stepOrder}`}
          </h3>
          <div className="flex items-center gap-2">
            {!isNew && canDelete && (
              <Button
                type="button"
                variant="destructive"
                size="icon-sm"
                onClick={() => setConfirmDelete(true)}
                disabled={pending}
                title="Remove step"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              disabled={pending}
              aria-label="Close"
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* Action type grid */}
          <div>
            <span className="mb-2 block text-sm font-medium">Action type</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {ACTION_TYPES.map((opt) => {
                const Icon = opt.icon
                const isActive = actionType === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => canEdit && setActionType(opt.value)}
                    disabled={!canEdit}
                    aria-pressed={isActive}
                    title={opt.description}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition-all',
                      isActive
                        ? cn('ring-1 ring-offset-1', opt.activeClass)
                        : 'border-muted hover:bg-muted/50',
                      !canEdit && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <Icon className="size-5" aria-hidden="true" />
                    <span className="text-xs font-medium">{opt.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Delay */}
          <div>
            <label
              htmlFor="step-delay"
              className="mb-1 block text-sm font-medium"
            >
              Delay after previous step
            </label>
            <div className="flex items-center gap-2">
              <input
                id="step-delay"
                type="number"
                min={0}
                value={delayValue}
                onChange={(e) =>
                  setDelayValue(Math.max(0, Number.parseInt(e.target.value, 10) || 0))
                }
                disabled={!canEdit}
                className={cn(inputClasses, 'max-w-[120px]')}
              />
              <select
                value={delayUnit}
                onChange={(e) => {
                  const next = e.target.value as DelayUnit
                  if (next === 'days' && delayUnit === 'hours') {
                    setDelayValue(Math.round(delayValue / 24))
                  } else if (next === 'hours' && delayUnit === 'days') {
                    setDelayValue(delayValue * 24)
                  }
                  setDelayUnit(next)
                }}
                disabled={!canEdit}
                className={cn(inputClasses, 'max-w-[120px]')}
              >
                <option value="hours">Hours</option>
                <option value="days">Days</option>
              </select>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {delayHours === 0
                ? 'Executes immediately after the previous step'
                : `Waits ${delayHours} hour${delayHours === 1 ? '' : 's'} (${(delayHours / 24).toFixed(1)} days)`}
            </p>
          </div>

          {/* Email-specific fields */}
          {actionType === 'EMAIL' ? (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">Email step</h4>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  Personalization tags
                  <HelpTooltip
                    text="These tags get replaced with real data when the email sends. For example, {{FirstName}} becomes the lead's first name."
                  />
                </span>
              </div>

              <div>
                <label
                  htmlFor="step-subject"
                  className="mb-1 block text-sm font-medium"
                >
                  Subject
                </label>
                <input
                  id="step-subject"
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  disabled={!canEdit}
                  placeholder="e.g. Quick question about {{CompanyName}}"
                  className={inputClasses}
                />
              </div>

              <div>
                <span className="mb-1 block text-sm font-medium">Body</span>
                {canEdit ? (
                  <RichTextEditor
                    defaultValue={emailBody}
                    onChange={setEmailBody}
                    placeholder="Hi {{FirstName}}, I noticed your team at {{CompanyName}}…"
                    minHeight="160px"
                  />
                ) : (
                  <div
                    className="prose prose-sm max-w-none rounded-md border bg-background px-3 py-2 text-sm opacity-60"
                    dangerouslySetInnerHTML={{
                      __html:
                        emailBody
                        || '<p class="text-muted-foreground">No body content</p>',
                    }}
                  />
                )}
              </div>

              {/* AI generation is intentionally excluded here — cadence
                  steps are templates that aren't tied to a single lead,
                  so the generator (which needs a leadId for context)
                  belongs on the lead detail page where it can pull the
                  recipient's profile and history. */}
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
              <h4 className="text-sm font-medium">Task details</h4>
              <div>
                <label
                  htmlFor="step-task-title"
                  className="mb-1 block text-sm font-medium"
                >
                  Title
                </label>
                <input
                  id="step-task-title"
                  type="text"
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  disabled={!canEdit}
                  placeholder={taskTitlePlaceholder(actionType)}
                  className={inputClasses}
                />
              </div>
              <div>
                <label
                  htmlFor="step-task-desc"
                  className="mb-1 block text-sm font-medium"
                >
                  Description
                </label>
                <textarea
                  id="step-task-desc"
                  rows={3}
                  value={taskDescription}
                  onChange={(e) => setTaskDescription(e.target.value)}
                  disabled={!canEdit}
                  placeholder="Optional instructions for the task…"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
            </div>
          )}

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          {confirmDelete && step ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <span className="flex-1">
                Permanently remove this step? Remaining steps will be renumbered
                automatically.
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmDelete(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={runDelete}
                disabled={pending}
              >
                {pending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    <span>Deleting…</span>
                  </>
                ) : (
                  <span>Yes, remove</span>
                )}
              </Button>
            </div>
          ) : null}
        </div>

        {canEdit && (
          <footer className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={save} disabled={pending}>
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  <span>Saving…</span>
                </>
              ) : (
                <span>{isNew ? 'Add step' : 'Update step'}</span>
              )}
            </Button>
          </footer>
        )}
      </div>
    </div>
  )
}

function taskTitlePlaceholder(action: StepActionType): string {
  switch (action) {
    case 'CALL':
      return 'e.g. Call — Leave Voicemail'
    case 'LINKEDIN':
      return 'e.g. LinkedIn Connection Request'
    case 'MANUAL_TASK':
      return 'e.g. Follow up task'
    default:
      return 'Task title'
  }
}

const inputClasses =
  'flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

/**
 * Coerces a server-action payload (Date columns serialize as strings or
 * Date instances depending on the runtime) to the canonical CadenceStep
 * shape consumed by the cadence builder.
 */
function serializeStep(raw: unknown): CadenceStep {
  const r = raw as {
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
  return {
    id: r.id,
    cadenceId: r.cadenceId,
    stepOrder: r.stepOrder,
    actionType: r.actionType as StepActionType,
    delayHours: r.delayHours,
    emailSubject: r.emailSubject,
    emailBody: r.emailBody,
    taskTitle: r.taskTitle,
    taskDescription: r.taskDescription,
    createdAt:
      r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    updatedAt:
      r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
  }
}
