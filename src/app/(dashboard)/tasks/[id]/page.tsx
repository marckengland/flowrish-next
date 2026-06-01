import { notFound } from 'next/navigation'

import { requireSession } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { getTaskById } from '@/server/services/tasks'
import { AppError } from '@/lib/errors'

import { TaskDetailView } from '@/components/tasks/task-detail'
import type { TaskItem } from '@/hooks/use-tasks'

/**
 * Task detail page — Server Component.
 *
 * Loads a single task by id within the user's organization, then hands
 * a serialized payload to the client view. Tasks share the leads
 * permission family (a follow-up belongs to the lead's access scope),
 * so we gate on `leads:read`/`leads:write` to match the task list page.
 */
export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<React.JSX.Element> {
  const { id } = await params
  const session = await requireSession()

  if (!hasPermission(session.dbUser, 'leads:read')) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-md border bg-card p-6">
        <h1 className="text-lg font-semibold">Task</h1>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view tasks in this organization.
        </p>
      </div>
    )
  }

  const canWrite = hasPermission(session.dbUser, 'leads:write')

  let task
  try {
    task = await getTaskById(id, session.organizationId)
  } catch (err) {
    if (err instanceof AppError && err.code === 'TASK_NOT_FOUND') {
      notFound()
    }
    throw err
  }

  return (
    <TaskDetailView
      task={toTaskItem(task)}
      canComplete={canWrite}
      canReassign={canWrite && !task.isComplete}
    />
  )
}

/**
 * Normalises the Prisma task row into the JSON-serializable shape
 * `TaskItem` consumers expect. Mirrors the helper of the same name in
 * the tasks list page so detail and list views agree byte-for-byte.
 */
function toTaskItem(
  task: Awaited<ReturnType<typeof getTaskById>>,
): TaskItem {
  const withIncludes = task as unknown as {
    lead?: { id: string; firstName: string; lastName: string } | null
    assignee?: { id: string; name: string; email: string } | null
  }
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    priority: task.priority,
    dueDate: toIso(task.dueDate),
    isComplete: task.isComplete,
    completedAt: task.completedAt ? toIso(task.completedAt) : null,
    leadId: task.leadId,
    assigneeId: task.assigneeId,
    organizationId: task.organizationId,
    createdAt: toIso(task.createdAt),
    updatedAt: toIso(task.updatedAt),
    isOverdue: task.isOverdue,
    lead: withIncludes.lead
      ? {
          id: withIncludes.lead.id,
          firstName: withIncludes.lead.firstName,
          lastName: withIncludes.lead.lastName,
        }
      : null,
    assignee: withIncludes.assignee
      ? {
          id: withIncludes.assignee.id,
          name: withIncludes.assignee.name,
          email: withIncludes.assignee.email,
        }
      : null,
  }
}

function toIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString()
  return value
}
