import 'server-only'
import { z } from 'zod'
import { prisma } from '@/server/db/client'
import { taskHistoryQuery, taskHistoryData, taskHistoryEntry, type TaskHistoryData } from '@/lib/follow-up-task-history'
import { currentFollowUpAccess, followUpChanged, safeFollowUp } from './follow-up-access'
import { lockApprovedTask, recheckApprovedTask, approvedTaskHash } from './follow-up-task-review'
const proof = z.object({ inputHash: z.string().regex(/^[a-f0-9]{64}$/), taskHash: z.string().regex(/^[a-f0-9]{64}$/), taskId: z.string().min(1).max(128) })
const completion = z.object({ taskCompletion: proof.strict() }).strict()
const reschedule = z.object({ taskReschedule: proof.extend({ previousDueDate: z.string().datetime(), dueDate: z.string().datetime() }).strict() }).strict()
export async function listTaskHistory(organizationId: string, userId: string, id: string, raw: unknown) {
 const input = taskHistoryQuery.parse(raw)
 return safeFollowUp(() => prisma.$transaction(async db => {
  const snapshot = await lockApprovedTask(db, organizationId, userId, id, false, 'read'), taskId = snapshot.task.id
  const scanned = await db.auditEntry.findMany({
   where: { organizationId, entityType: 'FollowUpSuggestion', action: 'UPDATE', OR: [
    { changes: { path: ['taskCompletion', 'taskId'], equals: taskId } },
    { changes: { path: ['taskReschedule', 'taskId'], equals: taskId } },
   ] },
   orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (input.page - 1) * 20, take: 21,
   select: { id: true, changes: true, createdAt: true, userId: true, user: { select: { name: true } } },
  })
  const access = await currentFollowUpAccess(db, organizationId, userId), current = await recheckApprovedTask(db, organizationId, userId, snapshot, false)
  if (approvedTaskHash(current) !== approvedTaskHash(snapshot.task)) throw followUpChanged()
  const entries = scanned.slice(0, 20).flatMap<TaskHistoryData['entries'][number]>(row => {
   const done = completion.safeParse(row.changes), moved = reschedule.safeParse(row.changes)
   const base = { id: row.id, actor: row.userId === userId ? 'You' : row.user.name.trim().slice(0, 200) || 'Team member', occurredAt: row.createdAt.toISOString() }
   const data = done.success && done.data.taskCompletion.taskId === taskId ? { ...base, kind: 'completed' } : moved.success && moved.data.taskReschedule.taskId === taskId ? { ...base, kind: 'rescheduled', previousDueDate: moved.data.taskReschedule.previousDueDate, dueDate: moved.data.taskReschedule.dueDate } : null
   const parsed = taskHistoryEntry.safeParse(data)
   return parsed.success ? [parsed.data] : []
  })
  return { data: taskHistoryData.parse({ id, taskId, page: input.page, hasMore: scanned.length > 20, entries, checkedAt: new Date().toISOString() }), canWrite: access.canWrite }
 }, { timeout: 20000 }))
}
