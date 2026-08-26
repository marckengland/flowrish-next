'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  Calendar,
  Check,
  CheckCircle2,
  Loader2,
  TrendingUp,
  UserCog,
  User as UserIcon,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  useCompleteTaskMutation,
  type TaskItem,
} from '@/hooks/use-tasks'
import { TaskReassign } from '@/components/tasks/task-reassign'

export interface TaskDetailViewProps {
  task: TaskItem
  canComplete: boolean
  canReassign: boolean
}

/**
 * Read/act surface for a single task.
 *
 * Surfaces the same Complete and Reassign affordances as the task list
 * card, plus richer metadata (full description, ISO timestamps, lead
 * link). Reuses `useCompleteTaskMutation` so the cache stays in sync
 * with the list view automatically.
 */
export function TaskDetailView({
  task,
  canComplete,
  canReassign,
}: TaskDetailViewProps): React.JSX.Element {
  const router = useRouter()
  const completeMutation = useCompleteTaskMutation()
  const [reassignOpen, setReassignOpen] = useState(false)

  const overdue = task.isOverdue
  const isCompleting =
    completeMutation.isPending && completeMutation.variables === task.id
  const completeError =
    completeMutation.error && completeMutation.variables === task.id
      ? completeMutation.error
      : null

  const leadName = task.lead
    ? [task.lead.firstName, task.lead.lastName].filter(Boolean).join(' ').trim()
    : null

  return (
    <div className="flex flex-col gap-5">
      <nav className="text-sm">
        <Link
          href="/tasks"
          className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <span aria-hidden="true">←</span>
          <span>Back to tasks</span>
        </Link>
      </nav>

      <header
        data-overdue={overdue ? 'true' : 'false'}
        data-complete={task.isComplete ? 'true' : 'false'}
        className={cn(
          'flex flex-col gap-3 rounded-lg border bg-card p-5',
          overdue && 'border-danger/40 bg-danger-subtle',
          task.isComplete && 'opacity-80',
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Badge variant={priorityVariant(task.priority)} size="sm" className="uppercase">
                {task.priority}
              </Badge>
              {overdue ? (
                <Badge variant="danger" size="sm" role="status">
                  <AlertTriangle className="size-3" aria-hidden="true" />
                  Overdue
                </Badge>
              ) : null}
              {task.isComplete ? (
                <Badge variant="brand" size="sm">
                  <CheckCircle2 className="size-3" aria-hidden="true" />
                  Completed
                </Badge>
              ) : null}
            </div>
            <h1
              className={cn(
                'mt-2 text-2xl font-semibold tracking-tight text-foreground',
                task.isComplete && 'line-through',
              )}
            >
              {task.title}
            </h1>
          </div>

          {!task.isComplete && canComplete ? (
            <div className="flex flex-wrap items-center gap-2">
              {canReassign ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setReassignOpen(true)}
                >
                  <UserCog className="size-3.5" aria-hidden="true" />
                  <span>Reassign</span>
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                onClick={() => completeMutation.mutate(task.id)}
                disabled={isCompleting}
              >
                {isCompleting ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    <span>Saving…</span>
                  </>
                ) : (
                  <>
                    <Check className="size-3.5" aria-hidden="true" />
                    <span>Mark complete</span>
                  </>
                )}
              </Button>
            </div>
          ) : null}
        </div>

        {completeError ? (
          <p role="alert" className="text-xs text-danger-foreground">
            {completeError instanceof Error
              ? completeError.message
              : 'Couldn’t complete task.'}
          </p>
        ) : null}
      </header>

      <section
        aria-labelledby="task-meta"
        className="rounded-lg border bg-card"
      >
        <h2 id="task-meta" className="sr-only">
          Task details
        </h2>
        <dl className="divide-y text-sm">
          <DetailRow icon={Calendar} label="Due">
            <time dateTime={task.dueDate}>{formatDateTime(task.dueDate)}</time>
          </DetailRow>
          {task.completedAt ? (
            <DetailRow icon={CheckCircle2} label="Completed">
              <time dateTime={task.completedAt}>
                {formatDateTime(task.completedAt)}
              </time>
            </DetailRow>
          ) : null}
          <DetailRow icon={TrendingUp} label="Lead">
            {leadName && task.lead ? (
              <Link
                href={`/leads/${task.lead.id}`}
                className="font-medium text-brand-emphasis hover:underline"
              >
                {leadName}
              </Link>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </DetailRow>
          <DetailRow icon={UserIcon} label="Assignee">
            {task.assignee ? (
              <span className="text-foreground">
                {task.assignee.name?.trim() || task.assignee.email}
              </span>
            ) : (
              <span className="text-muted-foreground">Unassigned</span>
            )}
          </DetailRow>
        </dl>
      </section>

      {task.description ? (
        <section
          aria-labelledby="task-description"
          className="flex flex-col gap-2 rounded-lg border bg-card p-[18px]"
        >
          <h2
            id="task-description"
            className="text-sm font-semibold text-foreground"
          >
            Description
          </h2>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {task.description}
          </p>
        </section>
      ) : null}

      {reassignOpen && task.assignee ? (
        <TaskReassign
          open
          onClose={() => setReassignOpen(false)}
          taskId={task.id}
          taskTitle={task.title}
          currentAssigneeId={task.assignee.id}
          onReassigned={() => {
            setReassignOpen(false)
            router.refresh()
          }}
        />
      ) : null}
    </div>
  )
}

interface DetailRowProps {
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  label: string
  children: React.ReactNode
}

function DetailRow({ icon: Icon, label, children }: DetailRowProps) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] items-center gap-3 px-4 py-2.5">
      <dt className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

function priorityVariant(
  priority: TaskItem['priority'],
): 'danger' | 'warning' | 'neutral' {
  switch (priority) {
    case 'HIGH':
      return 'danger'
    case 'MEDIUM':
      return 'warning'
    case 'LOW':
    default:
      return 'neutral'
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
