import { z } from 'zod'
import { prisma } from '@/server/db/client'
import { AppError } from '@/lib/errors'

export { isHumanReply, type ReplyMessage } from './email-reply-types'
export { reconcileStoredEmailReplies as reconcileEmailReplies } from './email-routing'

export const followUpReviewSchema = z.object({
  action: z.enum(['approve', 'dismiss']),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(10000).optional(),
  dueDate: z.string().datetime({ offset: true }).optional(),
}).strict()

export async function reviewFollowUp(organizationId: string, userId: string, id: string, input: z.input<typeof followUpReviewSchema>) {
  const values = followUpReviewSchema.parse(input)
  return prisma.$transaction(async (tx) => {
    const where = { id, organizationId, assigneeId: userId }
    const suggestion = await tx.followUpSuggestion.findFirst({ where })
    if (!suggestion) throw new AppError('NOT_FOUND', 'Follow-up not found', 404)
    if (suggestion.status !== 'PENDING') return suggestion
    const lead = await tx.lead.findFirst({ where: { id: suggestion.leadId, organizationId, deletedAt: null } })
    if (!lead) throw new AppError('NOT_FOUND', 'The lead is no longer available', 404)
    const member = await tx.organizationMember.findUnique({ where: { userId_organizationId: { userId, organizationId } } })
    if (!member) throw new AppError('FORBIDDEN', 'The assignee must be a current member', 403)
    const status = values.action === 'approve' ? 'APPROVED' : 'DISMISSED'
    const claim = await tx.followUpSuggestion.updateMany({ where: { ...where, status: 'PENDING' }, data: { status } })
    if (!claim.count) {
      const current = await tx.followUpSuggestion.findFirst({ where })
      if (current && current.status !== 'PENDING') return current
      throw new AppError('CONFLICT', 'This follow-up was already reviewed', 409)
    }
    let taskId = suggestion.taskId
    if (status === 'APPROVED' && taskId) {
      const task = await tx.task.findFirst({ where: { id: taskId, organizationId, assigneeId: userId, leadId: suggestion.leadId } })
      if (!task) throw new AppError('NOT_FOUND', 'The callback task is no longer available', 404)
    }
    if (status === 'APPROVED' && !taskId) {
      const task = await tx.task.create({ data: { organizationId, leadId: suggestion.leadId, assigneeId: userId, title: values.title ?? suggestion.title, description: values.description ?? suggestion.description, priority: 'MEDIUM', dueDate: values.dueDate ? new Date(values.dueDate) : new Date() } })
      taskId = task.id
    }
    const result = await tx.followUpSuggestion.update({ where: { id, organizationId }, data: { taskId, ...(suggestion.taskId ? {} : { title: values.title ?? suggestion.title, description: values.description ?? suggestion.description }) } })
    await tx.auditEntry.create({ data: { organizationId, userId, action: 'UPDATE', entityType: 'FollowUpSuggestion', entityId: id, changes: { status, taskId } } })
    return result
  })
}

/** Materializes existing callback tasks without changing the receptionist capture contract. */
export async function listFollowUps(organizationId: string, userId: string, status = 'PENDING') {
  if (!['PENDING', 'APPROVED', 'DISMISSED'].includes(status)) throw new AppError('VALIDATION_ERROR', 'Invalid follow-up status', 400)
  const ownedTasks = await prisma.task.findMany({ where: { organizationId, assigneeId: userId, lead: { organizationId, deletedAt: null } }, select: { id: true } })
  const callbacks = await prisma.receptionistCall.findMany({ where: { organizationId, status: 'completed', taskId: { in: ownedTasks.map((task) => task.id) }, leadId: { not: null } }, orderBy: { createdAt: 'desc' }, take: 100 })
  for (const call of callbacks) {
    const task = await prisma.task.findFirst({ where: { id: call.taskId!, organizationId, assigneeId: userId, leadId: call.leadId!, lead: { deletedAt: null, organizationId } } })
    if (!task) continue
    const sourceKey = JSON.stringify(['call', call.id])
    await prisma.followUpSuggestion.createMany({ data: { organizationId, assigneeId: userId, leadId: task.leadId, sourceKey, sourceType: 'CALL', sourceId: call.id, sourceText: task.description ?? '', title: task.title, description: task.description ?? '', taskId: task.id }, skipDuplicates: true })
    // Pending callback reviews follow task reassignment; reviewed history stays
    // with the reviewer who made the decision.
    await prisma.followUpSuggestion.updateMany({ where: { organizationId, sourceKey, status: 'PENDING', assigneeId: { not: userId } }, data: { assigneeId: userId } })
  }
  const rows = await prisma.followUpSuggestion.findMany({ where: { organizationId, assigneeId: userId, status }, orderBy: { createdAt: 'desc' }, take: 100 })
  const leads = await prisma.lead.findMany({ where: { organizationId, deletedAt: null, id: { in: rows.map((r) => r.leadId) } }, select: { id: true, firstName: true, lastName: true, email: true } })
  const byId = new Map(leads.map((lead) => [lead.id, lead]))
  const ownedTaskIds = new Set(ownedTasks.map((task) => task.id))
  return rows.flatMap((row) => {
    if (row.sourceType === 'CALL' && row.status === 'PENDING' && (!row.taskId || !ownedTaskIds.has(row.taskId))) return []
    const lead = byId.get(row.leadId)
    const parsedContext = z.object({ accountId: z.string(), provider: z.enum(['gmail', 'microsoft']), threadId: z.string(), recipientEmail: z.string().email(), mailboxEmail: z.string().email(), messageCount: z.number().int().positive(), lastMessageAt: z.string() }).safeParse(row.draftContext)
    return lead ? [{ ...row, draftContext: parsedContext.success ? parsedContext.data : null, lead }] : []
  })
}
