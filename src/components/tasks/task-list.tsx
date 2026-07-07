'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Check, Loader2, UserCog } from 'lucide-react'

import { Button } from '@/components/ui/button'
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
 * - Sorted by `dueDate` ascending (server-enforced per Requirement 18.4)
 * - Overdue rows (`isOverdue: true`) carry a destructive accent and
 *   visible badge so they stand out — no grace period, the server flags
 *   a task the moment its due time passes
 * - Completed tasks are rendered with a muted strike-through so the same
 *   list can toggle between open/completed via filter without rebuilding
 * - Tapping "Complete" fires `useCompleteTaskMutation`, which hits
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
        className="flex items-center gap-2 rounded-md border bg-card p-4 text-sm text-muted-foreground"
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
        className="rounded-md border bg-card p-4 text-sm text-destructive"
      >
        Couldn&apos;t load tasks.{' '}
        {query.error instanceof Error ? query.error.message : ''}
      </div>
    )
  }

  if (tasks.length === 0) {
    return (
      <div className="rounded-md border bg-card p-6 text-sm text-muted-foreground">
        No tasks match the current filters. Create a task to start tracking
        follow-ups.
      </div>
    )
  }

  return (
    <ol
      aria-label="Task list"
      className="flex flex-col gap-2"
    >
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
      {reassignTask ? (
        <TaskReassign
          open
          onClose={() => setReassignTask(null)}
          taskId={reassignTask.id}
          taskTitle={reassignTask.title}
          currentAssigneeId={reassignTask.assigneeId}
        />
      ) : null}
    </ol>
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
  const overdue = task.isOverdue
  const priorityClass = priorityAccent(task.priority)
  const leadName = task.lead
    ? [task.lead.firstName, task.lead.lastName].filter(Boolean).join(' ').trim()
    : null

  return (
    <article
      data-overdue={overdue ? 'true' : 'false'}
      data-complete={task.isComplete ? 'true' : 'false'}
      className={cn(
        'relative flex cursor-pointer flex-col gap-2 rounded-md border bg-card p-3 transition-colors hover:bg-muted/30 focus-within:bg-muted/30',
        overdue && 'border-destructive/40 bg-destructive/5',
        task.isComplete && 'opacity-70',
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3
            className={cn(
              'text-sm font-medium text-foreground',
              task.isComplete && 'line-through',
            )}
          >
            <Link
              href={`/tasks/${task.id}`}
              className="text-foreground before:absolute before:inset-0 before:content-[''] focus-visible:underline focus-visible:outline-none"
            >
              {task.title}
            </Link>
          </h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span
              className={cn(
                'inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                priorityClass,
              )}
            >
              {task.priority}
            </span>
            <time dateTime={task.dueDate}>
              Due {formatDateTime(task.dueDate)}
            </time>
            {overdue ? (
              <span
                role="status"
                className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-1.5 py-0.5 font-medium text-destructive"
              >
                <AlertTriangle className="size-3" aria-hidden="true" />
                Overdue
              </span>
            ) : null}
          </p>
        </div>

        {!task.isComplete && canComplete ? (
          <div className="relative z-10 flex items-center gap-1">
            {canReassign ? (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => onReassign()}
                aria-label={`Reassign "${task.title}"`}
                title="Reassign"
              >
                <UserCog className="size-3" aria-hidden="true" />
                <span>Reassign</span>
              </Button>
            ) : null}
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => onComplete()}
              disabled={isCompleting}
              aria-label={`Mark "${task.title}" complete`}
            >
              {isCompleting ? (
                <>
                  <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                  <span>Saving…</span>
                </>
              ) : (
                <>
                  <Check className="size-3" aria-hidden="true" />
                  <span>Complete</span>
                </>
              )}
            </Button>
          </div>
        ) : task.isComplete && task.completedAt ? (
          <span className="text-xs text-muted-foreground">
            Completed {formatDateTime(task.completedAt)}
          </span>
        ) : null}
      </header>

      {task.description ? (
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">
          {task.description}
        </p>
      ) : null}

      <footer className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {leadName && task.lead ? (
          <Link
            href={`/leads/${task.lead.id}`}
            className="relative z-10 inline-flex items-center gap-1 text-foreground transition-colors hover:underline focus-visible:underline"
          >
            <span aria-hidden="true">·</span>
            <span>{leadName || 'Lead'}</span>
          </Link>
        ) : null}
        {task.assignee ? (
          <span>
            Assigned to{' '}
            <span className="text-foreground">
              {task.assignee.name?.trim() || task.assignee.email}
            </span>
          </span>
        ) : null}
      </footer>

      {completeError ? (
        <p role="alert" className="text-xs text-destructive">
          {completeError instanceof Error
            ? completeError.message
            : 'Couldn’t complete task.'}
        </p>
      ) : null}
    </article>
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

function priorityAccent(priority: TaskItem['priority']): string {
  switch (priority) {
    case 'HIGH':
      return 'border-destructive/40 bg-destructive/10 text-destructive'
    case 'MEDIUM':
      return 'border-amber-400/40 bg-amber-100 text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-300'
    case 'LOW':
    default:
      return 'border-muted bg-muted text-muted-foreground'
  }
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}
