'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Check, Loader2, UserCog } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { TaskReassign } from '@/components/tasks/task-reassign'
import {
  useCompleteTaskMutation,
  useTasksQuery,
  type TaskItem,
  type TaskListFilters,
} from '@/hooks/use-tasks'

export interface TaskListProps {
  /**
   * Filters applied to the tasks query. The Server Component pre-filters
   * the initial render (so MEMBERs only see their own tasks per
   * Requirement 18.5) and passes the same filters here so the query key
   * matches the server-supplied `initialData`.
   */
  filters?: TaskListFilters
  /**
   * Tasks pre-fetched by the Server Component. TanStack Query adopts
   * this as the initial cache value so the list paints immediately.
   */
  initialTasks?: TaskItem[]
  /**
   * Whether the current user can mark tasks complete. Falls back to `true`
   * — the server enforces the real permission check (`leads:write`).
   */
  canComplete?: boolean
  /**
   * Whether the current user can reassign tasks. Defaults to the same
   * value as `canComplete` since they share the same `leads:write`
   * permission server-side.
   */
  canReassign?: boolean
}

/**
 * Task list with overdue highlighting and inline "Complete" action.
 *
 * Presented as a single card of divided rows (per the visual redesign):
 * a rounded checkbox that fills emerald when a task is completed, the
 * task title with a muted "lead · assignee" subline, and a right-aligned
 * status chip — a danger badge for overdue, a warning badge for tasks
 * due today, and a mono date otherwise. Completed tasks strike through
 * the title and dim the row.
 *
 * - Sorted by `dueDate` ascending (server-enforced per Requirement 18.4)
 * - Completed tasks are pushed to the bottom via `groupTasks`
 * - Tapping the checkbox fires `useCompleteTaskMutation`, which hits
 *   `PATCH /api/tasks/[id]` with `{ isComplete: true }` and invalidates
 *   the tasks cache on success
 *
 * Validates: Requirements 18.1, 18.3, 18.4, 18.5
 */
export function TaskList({
  filters = {},
  initialTasks,
  canComplete = true,
  canReassign,
}: TaskListProps): React.JSX.Element {
  const query = useTasksQuery(filters, initialTasks)
  const completeMutation = useCompleteTaskMutation()
  const [reassignTask, setReassignTask] = useState<TaskItem | null>(null)

  const allowReassign = canReassign ?? canComplete

  // Memoize client-side rendering details so we don't recompute per row
  // when sibling state (like the mutation `isPending` flag) changes.
  const grouped = useMemo(
    () => groupTasks(query.data ?? initialTasks ?? []),
    [query.data, initialTasks],
  )
  const tasks = grouped

  if (query.isLoading && tasks.length === 0) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 rounded-lg border bg-card p-4 text-sm text-muted-foreground"
      >
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        <span>Loading tasks…</span>
      </div>
    )
  }

  if (query.isError) {
    return (
      <div
        role="alert"
        className="rounded-lg border bg-card p-4 text-sm text-danger-foreground"
      >
        Couldn&apos;t load tasks.{' '}
        {query.error instanceof Error ? query.error.message : ''}
      </div>
    )
  }

  if (tasks.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        No tasks match the current filters. Create a task to start tracking
        follow-ups.
      </div>
    )
  }

  return (
    <>
      <Card className="overflow-hidden">
        <ol aria-label="Task list" className="divide-y divide-row-divider">
          {grouped.map((task) => (
            <li key={task.id}>
              <TaskRow
                task={task}
                canComplete={canComplete}
                canReassign={allowReassign && !task.isComplete}
                onReassign={() => setReassignTask(task)}
                isCompleting={
                  completeMutation.isPending &&
                  completeMutation.variables === task.id
                }
                onComplete={() => completeMutation.mutate(task.id)}
                completeError={
                  completeMutation.isError &&
                  completeMutation.variables === task.id
                    ? completeMutation.error
                    : null
                }
              />
            </li>
          ))}
        </ol>
      </Card>
      {reassignTask ? (
        <TaskReassign
          open
          onClose={() => setReassignTask(null)}
          taskId={reassignTask.id}
          taskTitle={reassignTask.title}
          currentAssigneeId={reassignTask.assigneeId}
        />
      ) : null}
    </>
  )
}

function TaskRow({
  task,
  canComplete,
  canReassign,
  onReassign,
  isCompleting,
  onComplete,
  completeError,
}: {
  task: TaskItem
  canComplete: boolean
  canReassign: boolean
  onReassign: () => void
  isCompleting: boolean
  onComplete: () => void
  completeError: unknown
}): React.JSX.Element {
  const overdue = task.isOverdue && !task.isComplete
  const dueToday = !overdue && !task.isComplete && isSameDay(task.dueDate, new Date())
  const leadName = task.lead
    ? [task.lead.firstName, task.lead.lastName].filter(Boolean).join(' ').trim()
    : null
  const assigneeName = task.assignee
    ? task.assignee.name?.trim() || task.assignee.email
    : null

  return (
    <article
      data-overdue={overdue ? 'true' : 'false'}
      data-complete={task.isComplete ? 'true' : 'false'}
      className={cn(
        'relative transition-colors hover:bg-background',
        task.isComplete && 'opacity-55',
      )}
    >
      <div className="flex items-center gap-3 px-[18px] py-3.5">
        <CompleteCheckbox
          task={task}
          canComplete={canComplete}
          isCompleting={isCompleting}
          onComplete={onComplete}
        />

        <div className="min-w-0 flex-1">
          <h3
            className={cn(
              'text-[13.5px] font-medium text-foreground',
              task.isComplete && 'line-through',
            )}
          >
            <Link
              href={`/tasks/${task.id}`}
              aria-label={`Open task ${task.title}`}
              className="text-foreground before:absolute before:inset-0 before:content-[''] focus-visible:underline focus-visible:outline-none"
            >
              {task.title}
            </Link>
          </h3>
          {leadName || assigneeName ? (
            <p className="mt-0.5 flex flex-wrap items-center gap-1 truncate text-xs text-muted-foreground">
              {leadName && task.lead ? (
                <Link
                  href={`/leads/${task.lead.id}`}
                  className="relative z-10 transition-colors hover:text-foreground hover:underline"
                >
                  {leadName}
                </Link>
              ) : null}
              {leadName && assigneeName ? (
                <span aria-hidden="true">·</span>
              ) : null}
              {assigneeName ? <span>{assigneeName}</span> : null}
            </p>
          ) : null}
        </div>

        <div className="relative z-10 flex shrink-0 items-center gap-2">
          {canReassign ? (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              onClick={() => onReassign()}
              aria-label={`Reassign "${task.title}"`}
              title="Reassign"
            >
              <UserCog aria-hidden="true" />
            </Button>
          ) : null}
          <StatusChip task={task} overdue={overdue} dueToday={dueToday} />
        </div>
      </div>

      {completeError ? (
        <p role="alert" className="px-[18px] pb-2.5 text-xs text-danger-foreground">
          {completeError instanceof Error
            ? completeError.message
            : 'Couldn’t complete task.'}
        </p>
      ) : null}
    </article>
  )
}

/**
 * Rounded checkbox affordance. Fills emerald with a check when the task
 * is complete; renders an interactive toggle button when the user can
 * complete tasks; otherwise renders a static empty box.
 */
function CompleteCheckbox({
  task,
  canComplete,
  isCompleting,
  onComplete,
}: {
  task: TaskItem
  canComplete: boolean
  isCompleting: boolean
  onComplete: () => void
}): React.JSX.Element {
  if (task.isComplete) {
    return (
      <span
        aria-hidden="true"
        className="flex size-[18px] shrink-0 items-center justify-center rounded-[5px] bg-brand text-brand-foreground"
      >
        <Check className="size-3" strokeWidth={3} />
      </span>
    )
  }

  if (canComplete) {
    return (
      <button
        type="button"
        onClick={() => onComplete()}
        disabled={isCompleting}
        aria-label={`Mark "${task.title}" complete`}
        className="relative z-10 flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border-2 border-muted-foreground/40 text-transparent transition-colors hover:border-brand hover:text-brand focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand/25 disabled:opacity-50"
      >
        {isCompleting ? (
          <Loader2 className="size-3 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : (
          <Check className="size-3" strokeWidth={3} aria-hidden="true" />
        )}
      </button>
    )
  }

  return (
    <span
      aria-hidden="true"
      className="flex size-[18px] shrink-0 rounded-[5px] border-2 border-muted-foreground/30"
    />
  )
}

/**
 * Right-aligned status chip: danger badge for overdue, warning badge for
 * due-today, a mono "Done" marker for completed tasks, and a mono date
 * otherwise.
 */
function StatusChip({
  task,
  overdue,
  dueToday,
}: {
  task: TaskItem
  overdue: boolean
  dueToday: boolean
}): React.JSX.Element {
  if (task.isComplete) {
    return (
      <span
        className="font-mono text-[11px] tnum text-muted-foreground"
        title={
          task.completedAt
            ? `Completed ${formatDateTime(task.completedAt)}`
            : undefined
        }
      >
        Done
      </span>
    )
  }
  if (overdue) {
    return (
      <Badge variant="danger" role="status">
        Overdue
      </Badge>
    )
  }
  if (dueToday) {
    return <Badge variant="warning">Due today</Badge>
  }
  return (
    <time
      dateTime={task.dueDate}
      className="font-mono text-[11px] tnum text-muted-foreground"
    >
      {formatShortDate(task.dueDate)}
    </time>
  )
}

/**
 * Exported for tests — groups and orders tasks for display.
 *
 * The server already returns tasks sorted by `dueDate` ascending; this
 * helper preserves that order while pushing completed tasks to the
 * bottom so the open queue stays on top even when filters aren't set.
 */
export function groupTasks(tasks: readonly TaskItem[]): TaskItem[] {
  const open: TaskItem[] = []
  const done: TaskItem[] = []
  for (const t of tasks) {
    ;(t.isComplete ? done : open).push(t)
  }
  return [...open, ...done]
}

function formatShortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
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
