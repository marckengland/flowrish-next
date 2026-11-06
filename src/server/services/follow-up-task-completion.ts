import 'server-only'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { Prisma, Task } from '@prisma/client'
import { prisma } from '@/server/db/client'
import { taskCompletionInput, taskCompletionPreview, taskCompletionReceipt, type TaskCompletionInput } from '@/lib/follow-up-task-completion'
import { currentFollowUpAccess, followUpChanged, followUpLead, followUpUnavailable, lockFollowUpMember, requireFollowUpWrites, safeFollowUp } from './follow-up-access'

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const taskHash = (task: Task) => digest([task.id, task.organizationId, task.leadId, task.assigneeId, task.title, task.description, task.priority, task.dueDate, task.updatedAt, task.isComplete, task.completedAt])
const auditWhere = (organizationId: string, userId: string, id: string, requestId: string) => ({ id: requestId, organizationId, userId, entityType: 'FollowUpSuggestion', entityId: id, action: 'UPDATE' as const })
const proofSchema = z.object({ taskCompletion: z.object({ inputHash: z.string(), taskHash: z.string(), taskId: z.string() }).strict() })

async function locked(db: Prisma.TransactionClient, organizationId: string, userId: string, id: string, write: boolean) {
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
type Snapshot = Awaited<ReturnType<typeof locked>>
const version = ({ row, task, lead }: Snapshot) => digest([row.id, row.organizationId, row.assigneeId, row.leadId, row.taskId, row.status, row.updatedAt, taskHash(task), task.assignee.name, lead.firstName, lead.lastName])
async function finalTask(db: Prisma.TransactionClient, organizationId: string, userId: string, snapshot: Snapshot) {
 const { access } = await followUpLead(db, organizationId, userId, snapshot.row.leadId, true)
 const task = await db.task.findFirst({ where: { id: snapshot.task.id, organizationId, leadId: snapshot.row.leadId, ...access.taskScope } })
 if (!task) throw followUpUnavailable()
 return task
}
function receipt(id: string, requestId: string, task: Task, changes?: unknown) {
 const proof = proofSchema.safeParse(changes)
 const state = changes === undefined ? 'not-recorded' : proof.success && proof.data.taskCompletion.taskId === task.id && proof.data.taskCompletion.taskHash === taskHash(task) && task.isComplete && task.completedAt ? 'confirmed' : 'changed'
 return taskCompletionReceipt.parse({ id, requestId, state, task: state === 'confirmed' ? { id: task.id, dueDate: task.dueDate.toISOString(), completedAt: task.completedAt!.toISOString(), checkedAt: new Date().toISOString() } : null })
}
export async function previewTaskCompletion(organizationId: string, userId: string, id: string) {
 return safeFollowUp(() => prisma.$transaction(async db => {
  const snapshot = await locked(db, organizationId, userId, id, false)
  if (snapshot.task.isComplete) throw followUpChanged()
  await finalTask(db, organizationId, userId, snapshot)
  const { task, lead } = snapshot
  return taskCompletionPreview.parse({ id, version: version(snapshot), leadName: (lead.firstName + ' ' + lead.lastName).trim(), task: { id: task.id, title: task.title, description: task.description ?? '', assigneeId: task.assigneeId, assigneeName: task.assignee.name, dueDate: task.dueDate.toISOString() } })
 }, { timeout: 20000 }))
}
export async function readTaskCompletion(organizationId: string, userId: string, id: string, requestId: string) {
 z.string().uuid().parse(requestId)
 return safeFollowUp(() => prisma.$transaction(async db => {
  const snapshot = await locked(db, organizationId, userId, id, false)
  const audit = await db.auditEntry.findFirst({ where: auditWhere(organizationId, userId, id, requestId), select: { changes: true } })
  const task = await finalTask(db, organizationId, userId, snapshot)
  return receipt(id, requestId, task, audit?.changes)
 }, { timeout: 20000 }))
}
export async function completeFollowUpTask(organizationId: string, userId: string, id: string, raw: unknown) {
 const input: TaskCompletionInput = taskCompletionInput.parse(raw)
 requireFollowUpWrites()
 return safeFollowUp(() => prisma.$transaction(async db => {
  const snapshot = await locked(db, organizationId, userId, id, true)
  if (snapshot.task.id !== input.taskId) throw followUpChanged()
  const audit = await db.auditEntry.findFirst({ where: auditWhere(organizationId, userId, id, input.requestId), select: { changes: true } })
  if (audit) {
   const proof = proofSchema.safeParse(audit.changes), task = await finalTask(db, organizationId, userId, snapshot)
   const result = receipt(id, input.requestId, task, audit.changes)
   if (!proof.success || proof.data.taskCompletion.inputHash !== digest(input) || result.state !== 'confirmed') throw followUpChanged()
   return result
  }
  if (snapshot.task.isComplete || version(snapshot) !== input.expectedVersion) throw followUpChanged()
  await finalTask(db, organizationId, userId, snapshot)
  const now = new Date()
  const task = await db.task.update({ where: { id: snapshot.task.id, organizationId, leadId: snapshot.row.leadId, assigneeId: snapshot.task.assigneeId, isComplete: false, updatedAt: snapshot.task.updatedAt }, data: { isComplete: true, completedAt: now } })
  await db.activity.create({ data: { organizationId, leadId: task.leadId, createdById: userId, type: 'NOTE', notes: 'Task completed: ' + task.title } })
  await db.lead.update({ where: { id: task.leadId, organizationId }, data: { lastActivityAt: now } })
  const changes = { taskCompletion: { inputHash: digest(input), taskHash: taskHash(task), taskId: task.id } }
  await db.auditEntry.create({ data: { id: input.requestId, organizationId, userId, entityType: 'FollowUpSuggestion', entityId: id, action: 'UPDATE', changes } })
  const final = await finalTask(db, organizationId, userId, snapshot)
  const result = receipt(id, input.requestId, final, changes)
  if (result.state !== 'confirmed') throw followUpChanged()
  return result
 }, { timeout: 20000 }))
}
