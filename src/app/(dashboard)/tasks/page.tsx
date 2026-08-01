import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/layout/page-header'
import { TaskForm } from '@/components/tasks/task-form'
import type {
  TaskFormAssigneeOption,
  TaskFormLeadOption,
} from '@/components/tasks/task-form'
import { TaskList } from '@/components/tasks/task-list'
import type { TaskItem, TaskListFilters } from '@/hooks/use-tasks'
import { hasPermission } from '@/server/auth/permissions'
import { requireSession } from '@/server/auth/session'
import { prisma } from '@/server/db/client'
import { getLeadAccessFilter } from '@/server/services/access'
import { getLeads } from '@/server/services/leads'
import { getTasks } from '@/server/services/tasks'

/**
 * Task management page — Server Component.
 *
 * Responsibilities:
 * 1. Require an authenticated session and `leads:read` permission (tasks
 *    live under the leads:* permission surface — see API handlers).
 * 2. Determine the current user's access scope for tasks:
 *    - OWNER/ADMIN/MANAGER see every task in the organization
 *    - MEMBERs only see tasks assigned to themselves (Requirement 18.5)
 *    This mirrors the access model used for leads.
 * 3. Pre-load the task list server-side so the page paints without a
 *    round-trip, then let TanStack Query adopt the data and refetch on
 *    mutation.
 * 4. Fetch lead and assignee option datasets needed by the task form so
 *    the selector dropdowns never leak cross-org identifiers.
 *
 * Validates: Requirements 18.1, 18.4, 18.5
 */
export default async function TasksPage(): Promise<React.JSX.Element> {
  const session = await requireSession()

  if (!hasPermission(session.dbUser, 'leads:read')) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-lg border bg-card p-6">
        <h1 className="text-lg font-semibold">Tasks</h1>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view tasks in this organization.
        </p>
      </div>
    )
  }

  const canWrite = hasPermission(session.dbUser, 'leads:write')

  // MEMBER-level users only see their own tasks (Requirement 18.5).
  // OWNER/ADMIN/MANAGER rely on tenant isolation middleware to scope to
  // the current organization and see the full org task list.
  const highestPrivilege = Math.min(
    ...session.dbUser.teamMemberships.map((m) => m.role.hierarchy),
    Infinity,
  )
  const isMemberOnly = highestPrivilege >= 3

  const filters: TaskListFilters = isMemberOnly
    ? { assigneeId: session.dbUser.id }
    : {}

  // Load tasks, candidate leads, and assignees in parallel. Leads go
  // through the RBAC-scoped service so the form can't surface leads the
  // user doesn't have access to.
  const [tasks, leadsPage, members] = await Promise.all([
    getTasks(session.dbUser.id, filters, session.organizationId),
    (async () => {
      const accessFilter = await getLeadAccessFilter(session.dbUser, session.organizationId)
      return getLeads(
        {},
        { page: 1, pageSize: 100 },
        accessFilter,
        session.organizationId,
      )
    })(),
    prisma.organizationMember.findMany({
      where: { organizationId: session.organizationId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { user: { name: 'asc' } },
    }),
  ])

  const initialTasks: TaskItem[] = tasks.map(toTaskItem)

  const leadOptions: TaskFormLeadOption[] = leadsPage.leads.map((l) => ({
    id: l.id,
    firstName: l.firstName,
    lastName: l.lastName,
    companyName: l.companyName,
  }))

  // MEMBERs can only assign tasks to themselves — matches the
  // "only see your own tasks" rule. Higher-privilege users can assign
  // across the whole organization.
  const assigneeOptions: TaskFormAssigneeOption[] = isMemberOnly
    ? [
        {
          id: session.dbUser.id,
          name: session.dbUser.name,
          email: session.dbUser.email,
        },
      ]
    : members.map((m) => ({
        id: m.userId,
        name: m.user.name,
        email: m.user.email,
      }))

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Tasks"
        description="Your action queue, ranked by the Rhythm engine"
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section aria-label="Task list" className="flex flex-col gap-3">
          <TaskList
            filters={filters}
            initialTasks={initialTasks}
            canComplete={canWrite}
          />
        </section>

        {canWrite ? (
          <aside
            aria-label="Create task"
            className="flex h-fit flex-col gap-4 rounded-lg border bg-card p-[18px]"
          >
            <header className="flex items-center gap-2">
              <Plus className="size-4 text-brand-emphasis" aria-hidden="true" />
              <h2 className="text-sm font-semibold">New task</h2>
            </header>
            {leadOptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Create a lead first — tasks must be linked to a lead.
              </p>
            ) : (
              <TaskForm
                leads={leadOptions}
                assignees={assigneeOptions}
                defaultAssigneeId={session.dbUser.id}
              />
            )}
          </aside>
        ) : (
          <aside
            aria-label="Create task"
            className="flex h-fit flex-col gap-4 rounded-lg border bg-card p-[18px]"
          >
            <header className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">New task</h2>
            </header>
            <p className="text-sm text-muted-foreground">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled
                aria-disabled="true"
              >
                <Plus className="size-4" aria-hidden="true" />
                <span>Create task</span>
              </Button>
            </p>
            <p className="text-xs text-muted-foreground">
              You don&apos;t have permission to create tasks.
            </p>
          </aside>
        )}
      </div>
    </div>
  )
}

/**
 * Normalises a task row returned from the task service into the JSON-
 * serializable shape expected by the `TaskList` client component. Dates
 * are converted to ISO strings so the initial cache matches the
 * `/api/tasks` payload byte-for-byte.
 *
 * The service adds a computed `isOverdue` field and Prisma `include`s
 * the lead (id/firstName/lastName) and assignee (id/name/email), but the
 * public `TaskWithOverdue` type keeps those as extra index-signature
 * entries. We narrow here by treating the row as `unknown` first, then
 * reading the known include shape.
 */
function toTaskItem(
  task: Awaited<ReturnType<typeof getTasks>>[number],
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
