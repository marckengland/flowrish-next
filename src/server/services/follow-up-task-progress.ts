import 'server-only'
import { Prisma } from '@prisma/client'
import { AppError } from '@/lib/errors'
import type { TaskProgress } from '@/lib/follow-up-task-progress'
import type { FollowUpFilters } from '@/lib/follow-up-filters'
import type { LeadAccessFilter } from './access'
export function matchesTaskProgress(value: TaskProgress, filter: FollowUpFilters['taskProgress']) { return !filter || value.state !== 'UNAVAILABLE' && (filter === 'OPEN' ? value.state === 'OPEN' || value.state === 'OVERDUE' : value.state === filter) }
export async function readTaskProgress(db: Prisma.TransactionClient, organizationId: string, rows: { id: string; leadId: string; taskId: string | null; status: string }[], access: { filter: LeadAccessFilter; taskScope: { assigneeId?: string } }, checkedAt: Date, pageIds: Set<string>, filter: FollowUpFilters['taskProgress']) {
 const ids = [...new Set(rows.filter(row => row.status === 'APPROVED' && row.taskId).map(row => row.taskId!))].sort()
 if (ids.length) await db.$queryRaw`SELECT id FROM "Task" WHERE "organizationId"=${organizationId} AND id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`
 const tasks = ids.length ? await db.task.findMany({ where: { organizationId, ...access.taskScope, id: { in: ids }, lead: { organizationId, mergedIntoId: null, AND: [access.filter] } }, select: { id: true, leadId: true, dueDate: true, isComplete: true, completedAt: true } }) : []
 const byId = new Map(tasks.map(task => [task.id, task])), result = new Map<string, TaskProgress>()
 for (const row of rows) {
  if (row.status !== 'APPROVED') continue
  const task = row.taskId ? byId.get(row.taskId) : undefined
  const value: TaskProgress = task && task.leadId === row.leadId && Number.isFinite(task.dueDate.getTime()) ? { state: task.isComplete ? 'COMPLETED' : task.dueDate < checkedAt ? 'OVERDUE' : 'OPEN', dueDate: task.dueDate.toISOString(), completedAt: task.isComplete && task.completedAt ? task.completedAt.toISOString() : null, checkedAt: checkedAt.toISOString() } : { state: 'UNAVAILABLE' }
  if (pageIds.has(row.id) && !matchesTaskProgress(value, filter)) throw new AppError('FOLLOW_UP_TASK_PROGRESS_CHANGED', 'Task progress changed while loading. Refresh to try again.', 409)
  result.set(row.id, value)
 }
 return result
}
