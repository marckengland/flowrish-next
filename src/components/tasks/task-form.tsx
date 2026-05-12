'use client'

import { useActionState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { createTask, updateTask } from '@/server/actions/tasks'

/**
 * Minimal lead option shape consumed by the lead selector.
 * The Server Component passes the list of leads the user can see so the
 * dropdown matches the RBAC scope enforced server-side.
 */
export interface TaskFormLeadOption {
  id: string
  firstName: string
  lastName: string
  companyName?: string | null
}

/**
 * Minimal assignee option shape consumed by the assignee selector.
 * The Server Component passes the list of organization members so the
 * selector can't leak users from other organizations.
 */
export interface TaskFormAssigneeOption {
  id: string
  name: string
  email: string
}

/**
 * Existing task shape accepted when the form is used in edit mode. Any
 * fields omitted from `task` simply render as empty — the form is
 * uncontrolled (defaultValue), matching the pattern in `LeadForm`.
 */
export interface TaskFormValues {
  id: string
  title: string
  description?: string | null
  priority: 'LOW' | 'MEDIUM' | 'HIGH'
  dueDate: string | Date
  leadId: string
  assigneeId: string
}

export interface TaskFormProps {
  /** Leads selectable as the target of this task. */
  leads: readonly TaskFormLeadOption[]
  /** Users available as task assignees. */
  assignees: readonly TaskFormAssigneeOption[]
  /** Provide a task to render the form in edit mode; omit for create mode. */
  task?: TaskFormValues | null
  /** Default assignee (typically the current user) when creating a task. */
  defaultAssigneeId?: string
  /** Pre-select a lead when creating a task from a lead detail page. */
  defaultLeadId?: string
  /** Optional callback invoked after a successful create/update. */
  onSuccess?: (taskId: string) => void
  /** Optional cancel handler — renders a Cancel button when provided. */
  onCancel?: () => void
  /** Override the submit label (defaults to Create Task / Save Changes). */
  submitLabel?: string
}

const PRIORITY_OPTIONS = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
] as const

type ActionResult = { error?: string; data?: { id: string } | null } | null

/**
 * Zod-validated create/edit form for tasks.
 *
 * - Renders every field covered by `taskCreateSchema` / `taskUpdateSchema`
 *   (title, description, dueDate, priority, leadId, assigneeId)
 * - Submits through React 19 `useActionState` to the `createTask` /
 *   `updateTask` Server Actions so validation, audit logging, and
 *   `revalidatePath` run on the server (Requirement 18.1)
 * - Surfaces the first validation error returned by the Server Action
 *
 * Validates: Requirements 18.1, 18.2, 18.4
 */
export function TaskForm({
  leads,
  assignees,
  task,
  defaultAssigneeId,
  defaultLeadId,
  onSuccess,
  onCancel,
  submitLabel,
}: TaskFormProps): React.JSX.Element {
  const isEditing = Boolean(task?.id)

  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    async (_prev, formData) => {
      const result = isEditing
        ? await updateTask(formData)
        : await createTask(formData)

      if (result && 'data' in result && result.data && 'id' in result.data) {
        onSuccess?.(result.data.id as string)
      }
      return result as ActionResult
    },
    null,
  )

  const defaultLead = task?.leadId ?? defaultLeadId ?? leads[0]?.id ?? ''
  const defaultAssignee =
    task?.assigneeId ?? defaultAssigneeId ?? assignees[0]?.id ?? ''
  const defaultPriority = task?.priority ?? 'MEDIUM'
  const defaultDueDate = toDateTimeLocal(task?.dueDate)

  const resolvedSubmitLabel =
    submitLabel ?? (isEditing ? 'Save Changes' : 'Create Task')
  const pendingLabel = isEditing ? 'Saving…' : 'Creating…'

  return (
    <form
      action={formAction}
      className="space-y-4"
      aria-busy={pending || undefined}
    >
      {isEditing && task?.id ? (
        <input type="hidden" name="id" value={task.id} />
      ) : null}

      <div>
        <label
          htmlFor="task-title"
          className="block text-sm font-medium text-foreground mb-1.5"
        >
          Title <span className="text-destructive">*</span>
        </label>
        <input
          id="task-title"
          name="title"
          required
          defaultValue={task?.title ?? ''}
          placeholder="e.g. Follow up on proposal"
          maxLength={500}
          className={inputClass}
        />
      </div>

      <div>
        <label
          htmlFor="task-description"
          className="block text-sm font-medium text-foreground mb-1.5"
        >
          Description
        </label>
        <textarea
          id="task-description"
          name="description"
          rows={3}
          defaultValue={task?.description ?? ''}
          placeholder="Optional notes for this task"
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label
            htmlFor="task-due-date"
            className="block text-sm font-medium text-foreground mb-1.5"
          >
            Due date <span className="text-destructive">*</span>
          </label>
          <input
            id="task-due-date"
            name="dueDate"
            type="datetime-local"
            required
            defaultValue={defaultDueDate}
            className={inputClass}
          />
        </div>

        <div>
          <label
            htmlFor="task-priority"
            className="block text-sm font-medium text-foreground mb-1.5"
          >
            Priority
          </label>
          <select
            id="task-priority"
            name="priority"
            defaultValue={defaultPriority}
            className={selectClass}
          >
            {PRIORITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label
            htmlFor="task-lead"
            className="block text-sm font-medium text-foreground mb-1.5"
          >
            Lead <span className="text-destructive">*</span>
          </label>
          <select
            id="task-lead"
            name="leadId"
            required
            defaultValue={defaultLead}
            className={selectClass}
          >
            {leads.length === 0 ? (
              <option value="" disabled>
                No leads available
              </option>
            ) : (
              leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {leadLabel(l)}
                </option>
              ))
            )}
          </select>
        </div>

        <div>
          <label
            htmlFor="task-assignee"
            className="block text-sm font-medium text-foreground mb-1.5"
          >
            Assignee <span className="text-destructive">*</span>
          </label>
          <select
            id="task-assignee"
            name="assigneeId"
            required
            defaultValue={defaultAssignee}
            className={selectClass}
          >
            {assignees.length === 0 ? (
              <option value="" disabled>
                No assignees available
              </option>
            ) : (
              assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name?.trim() || a.email}
                </option>
              ))
            )}
          </select>
        </div>
      </div>

      {state?.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </Button>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? pendingLabel : resolvedSubmitLabel}
        </Button>
      </div>
    </form>
  )
}

const inputClass = cn(
  'flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
)

const selectClass = cn(
  'flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
)

function leadLabel(lead: TaskFormLeadOption): string {
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim()
  if (lead.companyName) {
    return `${name || 'Unnamed lead'} — ${lead.companyName}`
  }
  return name || 'Unnamed lead'
}

/**
 * Converts a Date or ISO string into the `YYYY-MM-DDTHH:mm` format the
 * `<input type="datetime-local">` control expects for its `defaultValue`.
 *
 * Returns an empty string when the input is absent or unparseable so the
 * control renders as "empty" in create mode.
 *
 * Exported for test coverage.
 */
export function toDateTimeLocal(
  value: Date | string | null | undefined,
): string {
  if (value === null || value === undefined || value === '') return ''
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return ''
  // Format in the browser's local timezone, YYYY-MM-DDTHH:mm.
  const pad = (n: number): string => String(n).padStart(2, '0')
  const year = d.getFullYear()
  const month = pad(d.getMonth() + 1)
  const day = pad(d.getDate())
  const hour = pad(d.getHours())
  const minute = pad(d.getMinutes())
  return `${year}-${month}-${day}T${hour}:${minute}`
}
