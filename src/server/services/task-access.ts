import 'server-only'
import type { Session, SessionUser } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { prisma } from '@/server/db/client'
import { createTenantPrisma } from '@/server/db/middleware'
import { AppError } from '@/lib/errors'
import { taskCreateSchema, taskUpdateSchema } from '@/lib/validators/tasks'
import { getLeadAccessFilter } from './access'
import {
  createTask,
  completeTask,
  reassignTask,
  getTaskById,
  getTasks,
  type TaskFilters,
} from './tasks'

export function memberTaskScope(user: SessionUser): boolean {
  return (
    Math.min(
      ...user.teamMemberships.map((member) => member.role.hierarchy),
      Infinity,
    ) >= 3
  )
}
function taskScope(session: Session) {
  return memberTaskScope(session.dbUser)
    ? { assigneeId: session.dbUser.id }
    : {}
}
async function checkAssignee(session: Session, assigneeId: string) {
  if (memberTaskScope(session.dbUser) && assigneeId !== session.dbUser.id)
    throw new AppError(
      'FORBIDDEN',
      'You can only assign tasks to yourself.',
      403,
    )
  const member = await prisma.organizationMember.findUnique({
    where: {
      userId_organizationId: {
        userId: assigneeId,
        organizationId: session.organizationId,
      },
    },
    select: { id: true },
  })
  if (!member)
    throw new AppError(
      'ASSIGNEE_NOT_FOUND',
      'The assignee is unavailable in this workspace.',
      404,
    )
}
/** Entry points derive authorization from the server session, never client filters. */
export async function getAuthorizedTasks(
  session: Session,
  filters: TaskFilters,
) {
  requirePermission(session.dbUser, 'leads:read')
  return getTasks(
    session.dbUser.id,
    { ...filters, ...taskScope(session) },
    session.organizationId,
  )
}
export async function getAuthorizedTask(session: Session, id: string) {
  requirePermission(session.dbUser, 'leads:read')
  return getTaskById(id, session.organizationId, taskScope(session))
}
export async function createAuthorizedTask(session: Session, raw: unknown) {
  requirePermission(session.dbUser, 'leads:write')
  const input = taskCreateSchema.parse(raw)
  await checkAssignee(session, input.assigneeId)
  const access = await getLeadAccessFilter(
    session.dbUser,
    session.organizationId,
  )
  return createTask(input, session.dbUser.id, session.organizationId, {
    ...access,
  })
}
export async function completeAuthorizedTask(session: Session, id: string) {
  requirePermission(session.dbUser, 'leads:write')
  return completeTask(
    id,
    session.dbUser.id,
    session.organizationId,
    taskScope(session),
  )
}
export async function reassignAuthorizedTask(
  session: Session,
  id: string,
  assigneeId: string,
) {
  requirePermission(session.dbUser, 'leads:write')
  await checkAssignee(session, assigneeId)
  return reassignTask(
    id,
    assigneeId,
    session.organizationId,
    taskScope(session),
  )
}
export async function updateAuthorizedTask(
  session: Session,
  id: string,
  raw: unknown,
) {
  requirePermission(session.dbUser, 'leads:write')
  const input = taskUpdateSchema.omit({ isComplete: true }).parse(raw)
  if (input.assigneeId) await checkAssignee(session, input.assigneeId)
  const db = createTenantPrisma(session.organizationId),
    where = { ...taskScope(session), id }
  if (!(await db.task.findFirst({ where, select: { id: true } })))
    throw new AppError('TASK_NOT_FOUND', 'Task not found', 404)
  // A single scoped update prevents partial reassignment when another field is invalid.
  return db.task.update({ where, data: input })
}

export async function createTaskFromProposal(
  session: Session,
  params: {
    title: string
    description?: string
    dueDate?: string
    priority?: 'LOW' | 'MEDIUM' | 'HIGH'
    leadId?: string
    assigneeId?: string
  },
) {
  requirePermission(session.dbUser, 'leads:write')
  let leadId = params.leadId
  if (!leadId) {
    const access = await getLeadAccessFilter(
      session.dbUser,
      session.organizationId,
    )
    const recent = await createTenantPrisma(
      session.organizationId,
    ).lead.findFirst({
      where: { ...access, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    })
    if (!recent)
      throw new AppError(
        'LEAD_NOT_FOUND',
        'Choose an accessible lead before creating a task.',
        404,
      )
    leadId = recent.id
  }
  return createAuthorizedTask(session, {
    ...params,
    leadId,
    assigneeId: params.assigneeId ?? session.dbUser.id,
    dueDate: params.dueDate
      ? new Date(params.dueDate)
      : new Date(Date.now() + 86400000),
  })
}
