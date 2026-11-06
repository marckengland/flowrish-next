import 'server-only'
import { createHash } from 'node:crypto'
import type { Prisma, Task } from '@prisma/client'
import { currentFollowUpAccess, followUpChanged, followUpLead, followUpUnavailable, lockFollowUpMember } from './follow-up-access'
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const approvedTaskHash = (task: Task) => digest([task.id, task.organizationId, task.leadId, task.assigneeId, task.title, task.description, task.priority, task.dueDate, task.updatedAt, task.isComplete, task.completedAt])
export async function lockApprovedTask(db: Prisma.TransactionClient, organizationId: string, userId: string, id: string, write: boolean) {
 await lockFollowUpMember(db, organizationId, userId)
 await currentFollowUpAccess(db, organizationId, userId, true)
 const where = { id, organizationId, assigneeId: userId }
 const before = await db.followUpSuggestion.findFirst({ where })
 if (!before) throw followUpUnavailable()
 if (write) await db.$queryRaw`SELECT id FROM "Lead" WHERE id=${before.leadId} AND "organizationId"=${organizationId} FOR UPDATE`
 else await db.$queryRaw`SELECT id FROM "Lead" WHERE id=${before.leadId} AND "organizationId"=${organizationId} FOR SHARE`
 if (before.taskId) {
  if (write) await db.$queryRaw`SELECT id FROM "Task" WHERE id=${before.taskId} AND "organizationId"=${organizationId} FOR UPDATE`
  else await db.$queryRaw`SELECT id FROM "Task" WHERE id=${before.taskId} AND "organizationId"=${organizationId} FOR SHARE`
 }
 await db.$queryRaw`SELECT id FROM "FollowUpSuggestion" WHERE id=${id} AND "organizationId"=${organizationId} FOR SHARE`
 const row = await db.followUpSuggestion.findFirst({ where })
 if (!row || !row.taskId) throw followUpUnavailable()
 if (row.taskId !== before.taskId || row.leadId !== before.leadId || row.status !== 'APPROVED') throw followUpChanged()
 const { lead, access } = await followUpLead(db, organizationId, userId, row.leadId, true)
 const task = await db.task.findFirst({ where: { id: row.taskId, organizationId, leadId: row.leadId, ...access.taskScope }, include: { assignee: { select: { name: true } } } })
 if (!task) throw followUpUnavailable()
 return { row, task, lead }
}
type Snapshot = Awaited<ReturnType<typeof lockApprovedTask>>
export const approvedTaskVersion = ({ row, task, lead }: Snapshot) => digest([row.id, row.organizationId, row.assigneeId, row.leadId, row.taskId, row.status, row.updatedAt, approvedTaskHash(task), task.assignee.name, lead.firstName, lead.lastName])
export async function recheckApprovedTask(db: Prisma.TransactionClient, organizationId: string, userId: string, snapshot: Snapshot) {
 const { access } = await followUpLead(db, organizationId, userId, snapshot.row.leadId, true)
 const task = await db.task.findFirst({ where: { id: snapshot.task.id, organizationId, leadId: snapshot.row.leadId, ...access.taskScope } })
 if (!task) throw followUpUnavailable()
 return task
}
