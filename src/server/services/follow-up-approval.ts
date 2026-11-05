import 'server-only'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/server/db/client'
import { approvalInput, approvalPreview, approvalReceipt } from '@/lib/follow-up-approval'
import { currentFollowUpAccess, followUpChanged, followUpLead, followUpUnavailable, lockFollowUpMember, safeFollowUp } from './follow-up-access'
import { approvalAuditWhere, approvalSnapshot, approvalTaskHash, approvalTaskView, readApprovalProof } from './follow-up-approval-guard'
import { reviewFollowUp } from './follow-ups'
async function locked(db: Prisma.TransactionClient, organizationId: string, userId: string, id: string) {
 await lockFollowUpMember(db, organizationId, userId); await currentFollowUpAccess(db, organizationId, userId, true)
 const where = { id, organizationId, assigneeId: userId }, before = await db.followUpSuggestion.findFirst({ where })
 if (!before) throw followUpUnavailable()
 await db.$queryRaw`SELECT id FROM "Lead" WHERE id=${before.leadId} AND "organizationId"=${organizationId} FOR SHARE`
 if (before.taskId) await db.$queryRaw`SELECT id FROM "Task" WHERE id=${before.taskId} AND "organizationId"=${organizationId} FOR SHARE`
 await db.$queryRaw`SELECT id FROM "FollowUpSuggestion" WHERE id=${id} AND "organizationId"=${organizationId} FOR SHARE`
 const row = await db.followUpSuggestion.findFirst({ where })
 if (!row) throw followUpUnavailable()
 if (row.leadId !== before.leadId || row.taskId !== before.taskId) throw followUpChanged()
 const { lead } = await followUpLead(db, organizationId, userId, row.leadId, true)
 return { row, lead }
}
export async function previewFollowUpApproval(organizationId: string, userId: string, id: string) {
 return safeFollowUp(() => prisma.$transaction(async db => {
  const { row, lead } = await locked(db, organizationId, userId, id)
  if (row.status !== 'PENDING') throw followUpChanged()
  const snapshot = await approvalSnapshot(db, row)
  await followUpLead(db, organizationId, userId, row.leadId, true)
  return approvalPreview.parse({ id, version: snapshot.version, sourceType: row.sourceType, assigneeId: userId, title: row.title, description: row.description, existingTask: snapshot.task ? approvalTaskView(snapshot.task) : null, leadName: `${lead.firstName} ${lead.lastName}`.trim() })
 }, { timeout: 20000 }))
}
export async function readFollowUpApproval(organizationId: string, userId: string, id: string, requestId: string) {
 z.string().uuid().parse(requestId)
 return safeFollowUp(() => prisma.$transaction(async db => {
  const { row } = await locked(db, organizationId, userId, id)
  const audit = await db.auditEntry.findFirst({ where: approvalAuditWhere(organizationId, userId, id, requestId), select: { changes: true } })
  let result = approvalReceipt.parse({ id, requestId, state: 'not-recorded', task: null })
  if (audit) {
   const proof = readApprovalProof(audit.changes)
   const task = row.taskId ? await db.task.findFirst({ where: { id: row.taskId, organizationId, assigneeId: userId, leadId: row.leadId, isComplete: false } }) : null
   const confirmed = proof.success && row.status === 'APPROVED' && task && task.id === proof.data.approval.taskId && approvalTaskHash(task) === proof.data.approval.taskHash
   result = approvalReceipt.parse({ id, requestId, state: confirmed ? 'confirmed' : 'changed', task: confirmed ? approvalTaskView(task) : null })
  }
  await followUpLead(db, organizationId, userId, row.leadId, true)
  return result
 }, { timeout: 20000 }))
}
export async function approveFollowUp(organizationId: string, userId: string, id: string, raw: unknown) {
 const input = approvalInput.parse(raw)
 await reviewFollowUp(organizationId, userId, id, { action: 'approve', title: input.title, description: input.description, dueDate: input.dueDate }, input)
 return readFollowUpApproval(organizationId, userId, id, input.requestId)
}
