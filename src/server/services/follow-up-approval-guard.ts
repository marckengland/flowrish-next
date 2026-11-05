import 'server-only'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { FollowUpSuggestion, Prisma, Task } from '@prisma/client'
import { approvalTask, sameApprovalTask, type ApprovalInput } from '@/lib/follow-up-approval'
import { followUpChanged, followUpUnavailable } from './follow-up-access'
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const approvalInputHash = (value: ApprovalInput) => digest(value)
export const approvalTaskHash = (task: Task) => digest([task.id, task.organizationId, task.leadId, task.assigneeId, task.title, task.description, task.dueDate, task.updatedAt, task.isComplete])
export const approvalTaskView = (task: Task) => approvalTask.parse({ id: task.id, assigneeId: task.assigneeId, title: task.title.trim(), description: task.description ?? '', dueDate: task.dueDate.toISOString() })
export const approvalAuditProof = z.object({ inputHash: z.string().regex(/^[a-f0-9]{64}$/), taskHash: z.string().regex(/^[a-f0-9]{64}$/), taskId: z.string().min(1).max(128) }).strict()
export const approvalAuditWhere = (organizationId: string, userId: string, id: string, requestId: string) => ({ id: requestId, organizationId, userId, entityType: 'FollowUpSuggestion', entityId: id, action: 'UPDATE' as const })
export function readApprovalProof(changes: unknown) { return z.object({ approval: approvalAuditProof }).safeParse(changes) }
export async function approvalSnapshot(db: Prisma.TransactionClient, row: FollowUpSuggestion) {
 const task = row.taskId ? await db.task.findFirst({ where: { id: row.taskId, organizationId: row.organizationId, leadId: row.leadId, assigneeId: row.assigneeId, isComplete: false } }) : null
 if (row.taskId && !task || row.sourceType === 'CALL' && !task || !['CALL', 'EMAIL'].includes(row.sourceType)) throw followUpUnavailable()
 const snooze = await db.followUpSnooze.findUnique({ where: { organizationId_userId_followUpId: { organizationId: row.organizationId, userId: row.assigneeId, followUpId: row.id } } })
 return { task, version: digest([row.id, row.organizationId, row.assigneeId, row.leadId, row.taskId, row.status, row.sourceType, row.sourceKey, row.sourceId, row.sourceThreadId, row.sourceText, row.title, row.description, row.updatedAt, snooze?.revision ?? 0, task ? approvalTaskHash(task) : null]) }
}
export async function assertReviewedApproval(db: Prisma.TransactionClient, organizationId: string, userId: string, row: FollowUpSuggestion, input: ApprovalInput) {
 if (input.assigneeId !== userId) throw followUpChanged()
 const audit = await db.auditEntry.findFirst({ where: approvalAuditWhere(organizationId, userId, row.id, input.requestId), select: { changes: true } })
 if (audit) {
  const proof = readApprovalProof(audit.changes), { task } = await approvalSnapshot(db, row)
  if (!proof.success || proof.data.approval.inputHash !== approvalInputHash(input) || row.status !== 'APPROVED' || !task || task.id !== proof.data.approval.taskId || approvalTaskHash(task) !== proof.data.approval.taskHash || !sameApprovalTask(approvalTaskView(task), input)) throw followUpChanged()
  return true
 }
 if (row.status !== 'PENDING') throw followUpChanged()
 const snapshot = await approvalSnapshot(db, row)
 if (snapshot.version !== input.expectedVersion || snapshot.task && !sameApprovalTask(approvalTaskView(snapshot.task), input)) throw followUpChanged()
 return false
}
export async function approvalAuditFields(db: Prisma.TransactionClient, organizationId: string, userId: string, leadId: string, taskId: string, input: ApprovalInput) {
 const task = await db.task.findFirst({ where: { id: taskId, organizationId, assigneeId: userId, leadId, isComplete: false } })
 if (!task || !sameApprovalTask(approvalTaskView(task), input)) throw followUpChanged()
 return { inputHash: approvalInputHash(input), taskHash: approvalTaskHash(task), taskId }
}
