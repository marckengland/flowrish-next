'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  ClipboardList,
  Handshake,
  Loader2,
  Mail,
  Paperclip,
  Phone,
  Trash2,
  type LucideIcon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { HelpTooltip } from '@/components/ui/help-tooltip'
import { inputBaseClass } from '@/components/ui/input'
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
  const [startNewThread, setStartNewThread] = useState<boolean>(
    step?.startNewThread ?? false,
  )
  const [taskTitle, setTaskTitle] = useState(step?.taskTitle ?? '')
  const [taskDescription, setTaskDescription] = useState(
    step?.taskDescription ?? '',
  )
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pending, startTransition] = useTransition()
  const [testStatus, setTestStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'sending' }
    | { kind: 'sent'; recipient: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  /**
   * Posts the current subject + body to `/api/email/test`, which sends
   * the message to the user's own connected Gmail account with sample
   * personalization data. Useful for previewing the rendered HTML and
   * tag substitution before activating the cadence.
   */
  async function sendTestEmail(): Promise<void> {
    if (!emailSubject.trim() || !emailBody.trim()) {
      setTestStatus({
        kind: 'error',
        message: 'Subject and body are required to send a test.',
      })
      return
    }
    setTestStatus({ kind: 'sending' })
    try {
      const res = await fetch('/api/email/test', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: emailSubject, body: emailBody }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setTestStatus({
          kind: 'error',
          message:
            data.error?.message ?? `Failed to send test (${res.status})`,
        })
        return
      }
      const data = (await res.json()) as { data: { recipient: string } }
      setTestStatus({ kind: 'sent', recipient: data.data.recipient })
    } catch (err) {
      setTestStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to send test.',
      })
    }
  }

  // Cadence step attachments. Loaded only in edit mode (new steps
  // don't have an id yet so the upload route can't associate files).
  const [attachments, setAttachments] = useState<StepAttachment[]>([])
  const [uploading, setUploading] = useState(false)
  // Pending files staged while authoring a brand-new step. Uploaded
  // immediately after the step is created so users don't have to
  // save, reopen, then attach.
  const [pendingFiles, setPendingFiles] = useState<File[]>([])

  // Refresh attachment list whenever the editor opens on a step or the
  // step swaps under us. We tolerate fetch failures silently — the rest
  // of the editor still works without attachments.
  useEffect(() => {
    if (!step?.id) {
      setAttachments([])
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(
          `/api/cadences/${cadenceId}/steps/${step.id}/attachments`,
          { credentials: 'same-origin' },
        )
        if (!res.ok) return
        const body = (await res.json()) as { data: StepAttachment[] }
        if (!cancelled) setAttachments(body.data)
      } catch {
        // ignore
      }
    })()
    return () => {
      cancelled = true
    }
  }, [cadenceId, step?.id])

  async function uploadAttachmentFiles(
    files: readonly File[],
  ): Promise<void> {
    if (files.length === 0) return
    // New step path — buffer files locally and upload after save.
    if (!step?.id) {
      setPendingFiles((prev) => [...prev, ...files])
      return
    }
    setError(null)
    setUploading(true)
    try {
      for (const file of files) {
        const formData = new FormData()
        formData.append('file', file, file.name)
        const res = await fetch(
          `/api/cadences/${cadenceId}/steps/${step.id}/attachments`,
          { method: 'POST', credentials: 'same-origin', body: formData },
        )
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: { message?: string }
          }
          setError(
            body.error?.message
              ?? `Failed to upload ${file.name} (${res.status})`,
          )
          continue
        }
        const body = (await res.json()) as { data: StepAttachment }
        setAttachments((prev) => [...prev, body.data])
      }
    } finally {
      setUploading(false)
    }
  }

  /**
   * Uploads a list of staged files to the just-created step. Used by
   * the "save then attach" flow when the editor is in add mode and
   * the user dropped files in before saving.
   */
  async function flushPendingFiles(stepId: string): Promise<void> {
    if (pendingFiles.length === 0) return
    for (const file of pendingFiles) {
      const formData = new FormData()
      formData.append('file', file, file.name)
      const res = await fetch(
        `/api/cadences/${cadenceId}/steps/${stepId}/attachments`,
        { method: 'POST', credentials: 'same-origin', body: formData },
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        // Surface the failure but don't block save — the step itself
        // exists; users can re-attempt from the editor.
        setError(
          body.error?.message
            ?? `Step saved but failed to attach ${file.name} (${res.status})`,
        )
      }
    }
    setPendingFiles([])
  }

  function removePendingFile(index: number): void {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index))
  }

  async function removeAttachment(attachmentId: string): Promise<void> {
    if (!step?.id) return
    setError(null)
    const res = await fetch(
      `/api/cadences/${cadenceId}/steps/${step.id}/attachments/${attachmentId}`,
      { method: 'DELETE', credentials: 'same-origin' },
    )
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: { message?: string }
      }
      setError(body.error?.message ?? `Failed to remove (${res.status})`)
      return
    }
    setAttachments((prev) => prev.filter((a) => a.id !== attachmentId))
  }

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
    setStartNewThread(step.startNewThread ?? false)
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
          if (startNewThread) formData.set('startNewThread', 'true')
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
          const saved = serializeStep(result.data)
          // Upload any files the user staged before saving the new step.
          if (pendingFiles.length > 0) {
            await flushPendingFiles(saved.id)
          }
          onSaved?.(saved)
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
        if (startNewThread !== (step!.startNewThread ?? false)) {
          patch.startNewThread = startNewThread
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

  const dialogTitle = (
    <div className="flex items-center gap-2">
      <span>{isNew ? 'Add step' : `Edit step ${step!.stepOrder}`}</span>
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
    </div>
  )

  const dialogFooter = canEdit ? (
    <>
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
    </>
  ) : undefined

  return (
    <Dialog
      open
      onClose={onClose}
      title={dialogTitle}
      size="lg"
      footer={dialogFooter}
      closeOnBackdrop={!pending}
    >
      <div className="space-y-5">
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

              {/* Threading control — by default a follow-up step is
                  sent as a reply on whatever Gmail thread the
                  enrollment opened on its first email. Flip this on
                  for breakup or re-engagement steps that read better
                  as a fresh subject line. The first email step in a
                  cadence always opens a new thread regardless. */}
              <div className="flex items-start gap-2 rounded-md border bg-background px-3 py-2">
                <input
                  id="step-thread-mode"
                  type="checkbox"
                  checked={startNewThread}
                  onChange={(e) => setStartNewThread(e.target.checked)}
                  disabled={!canEdit}
                  className="mt-0.5 size-3.5 cursor-pointer accent-primary disabled:cursor-not-allowed"
                />
                <label
                  htmlFor="step-thread-mode"
                  className={cn(
                    'flex flex-1 flex-col gap-0.5 text-xs',
                    !canEdit && 'cursor-not-allowed opacity-60',
                    canEdit && 'cursor-pointer',
                  )}
                >
                  <span className="font-medium text-foreground">
                    Start a new email thread
                  </span>
                  <span className="text-muted-foreground">
                    {startNewThread
                      ? 'This step opens a fresh Gmail conversation with its own subject line.'
                      : 'This step replies on the same Gmail thread the cadence opened on its first email.'}
                  </span>
                </label>
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
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="block text-sm font-medium">Body</span>
                  {canEdit ? (
                    <div className="flex items-center gap-2">
                      {testStatus.kind === 'sent' ? (
                        <span className="text-xs text-emerald-700 dark:text-emerald-300">
                          Sent to {testStatus.recipient}
                        </span>
                      ) : testStatus.kind === 'error' ? (
                        <span
                          role="alert"
                          className="text-xs text-destructive"
                        >
                          {testStatus.message}
                        </span>
                      ) : null}
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        onClick={sendTestEmail}
                        disabled={
                          testStatus.kind === 'sending'
                          || !emailSubject.trim()
                          || !emailBody.trim()
                        }
                        title="Send a preview to your own Gmail with sample personalization"
                      >
                        {testStatus.kind === 'sending'
                          ? 'Sending…'
                          : 'Send test email'}
                      </Button>
                    </div>
                  ) : null}
                </div>
                {canEdit ? (
                  <RichTextEditor
                    defaultValue={emailBody}
                    onChange={setEmailBody}
                    placeholder="Hi {{FirstName}}, I noticed your team at {{CompanyName}}…"
                    minHeight="160px"
                    onFilesDropped={(files) => uploadAttachmentFiles(files)}
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

              {/* Template-level attachments. Edit mode shows the
                  server-persisted list with delete controls. Add mode
                  buffers files locally and uploads them as soon as the
                  step is created on save. */}
              {canEdit && step?.id ? (
                <AttachmentSection
                  cadenceId={cadenceId}
                  stepId={step.id}
                  attachments={attachments}
                  onUpload={uploadAttachmentFiles}
                  onDelete={removeAttachment}
                  uploading={uploading}
                />
              ) : canEdit ? (
                <PendingAttachmentSection
                  files={pendingFiles}
                  onAdd={uploadAttachmentFiles}
                  onRemove={removePendingFile}
                />
              ) : null}

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
    </Dialog>
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

const inputClasses = inputBaseClass

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
    startNewThread?: boolean
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
    startNewThread: r.startNewThread ?? false,
    createdAt:
      r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    updatedAt:
      r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
  }
}


// ─── Attachment section ─────────────────────────────────────────────────────

/**
 * Shape of a cadence step attachment summary as returned by the API.
 * Mirrors `CadenceStepAttachmentSummary` on the server.
 */
interface StepAttachment {
  id: string
  stepId: string
  fileName: string
  fileSize: number
  mimeType: string
  uploadedById: string
  createdAt: string
}

interface AttachmentSectionProps {
  cadenceId: string
  stepId: string
  attachments: StepAttachment[]
  onUpload: (files: readonly File[]) => Promise<void>
  onDelete: (attachmentId: string) => Promise<void>
  uploading: boolean
}

/**
 * Template-level attachments section for an EMAIL cadence step. Files
 * uploaded here travel with every email the step sends — the runner
 * fetches them at execution time and bundles them into the outgoing
 * Gmail payload.
 *
 * The section ties in with the rich-text editor: dragging or pasting
 * files into the body also routes through the same upload path, so the
 * paperclip button below is just one of three ways to add files.
 */
function AttachmentSection({
  cadenceId,
  stepId,
  attachments,
  onUpload,
  onDelete,
  uploading,
}: AttachmentSectionProps): React.JSX.Element {
  // The inputId guards against id collisions when more than one step
  // editor lives on the page (rare today but cheap insurance).
  const inputId = `step-attach-${cadenceId}-${stepId}`

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">
          Attachments
        </span>
        <label
          htmlFor={inputId}
          className={cn(
            'inline-flex cursor-pointer items-center gap-1 rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted',
            uploading && 'cursor-wait opacity-60',
          )}
        >
          {uploading ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Paperclip className="size-3.5" aria-hidden="true" />
          )}
          <span>Attach file</span>
        </label>
        <input
          id={inputId}
          type="file"
          multiple
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            if (files.length > 0) void onUpload(files)
            e.target.value = ''
          }}
        />
      </div>
      {attachments.length === 0 ? (
        <p className="rounded-md border border-dashed bg-background/40 px-3 py-2 text-[11px] text-muted-foreground">
          No attachments yet. Use the paperclip in the editor toolbar, the
          button above, or drag &amp; drop files into the body. Up to 25 MB
          each.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {attachments.map((att) => (
            <li
              key={att.id}
              className="flex items-center justify-between rounded-md border bg-background px-2.5 py-1.5 text-xs"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Paperclip
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="truncate font-medium text-foreground">
                  {att.fileName}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {formatStepFileSize(att.fileSize)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void onDelete(att.id)}
                className="ml-2 shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                title={`Remove ${att.fileName}`}
                aria-label={`Remove ${att.fileName}`}
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function formatStepFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}


interface PendingAttachmentSectionProps {
  files: File[]
  onAdd: (files: readonly File[]) => Promise<void>
  onRemove: (index: number) => void
}

/**
 * Buffered attachment section used when authoring a brand-new step.
 * Files are held in component state until the step is saved, then
 * uploaded against the freshly-created step id. Mirrors the affordances
 * of the live `AttachmentSection` (paperclip + drag-drop + remove
 * buttons) so the UX is the same in both modes.
 */
function PendingAttachmentSection({
  files,
  onAdd,
  onRemove,
}: PendingAttachmentSectionProps): React.JSX.Element {
  const inputId = 'step-attach-pending'

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">
          Attachments
        </span>
        <label
          htmlFor={inputId}
          className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted"
        >
          <Paperclip className="size-3.5" aria-hidden="true" />
          <span>Attach file</span>
        </label>
        <input
          id={inputId}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const list = Array.from(e.target.files ?? [])
            if (list.length > 0) void onAdd(list)
            e.target.value = ''
          }}
        />
      </div>
      {files.length === 0 ? (
        <p className="rounded-md border border-dashed bg-background/40 px-3 py-2 text-[11px] text-muted-foreground">
          Stage files for this step. They&apos;ll upload as soon as you save.
          Use the paperclip in the editor toolbar, the button above, or drag
          &amp; drop into the body.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {files.map((file, i) => (
            <li
              key={`${file.name}-${i}`}
              className="flex items-center justify-between rounded-md border border-dashed bg-background px-2.5 py-1.5 text-xs"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Paperclip
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="truncate font-medium text-foreground">
                  {file.name}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {formatStepFileSize(file.size)}
                </span>
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  pending
                </span>
              </div>
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="ml-2 shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                title={`Remove ${file.name}`}
                aria-label={`Remove ${file.name}`}
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
