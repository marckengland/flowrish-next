import { z } from 'zod'
import { prisma } from '@/server/db/client'
import { AppError } from '@/lib/errors'

export interface ReplyMessage {
  externalId: string
  threadId: string | null
  fromEmail: string
  toEmail: string
  recipientEmails?: string[]
  subject: string
  bodyPreview: string | null
  sentAt: string
  headers?: Array<{ name: string; value: string }>
}

export function isHumanReply(message: ReplyMessage, mailbox: string, enrollment: { emailThreadId: string | null; enrolledAt: Date }): boolean {
  const from = message.fromEmail.trim().toLowerCase()
  const address = mailbox.trim().toLowerCase()
  const recipients = (message.recipientEmails ?? [message.toEmail]).map((s) => s.trim().toLowerCase())
  const time = new Date(message.sentAt).getTime()
  if (!from || from === address || !recipients.includes(address) || !message.threadId || message.threadId !== enrollment.emailThreadId || !Number.isFinite(time) || time <= enrollment.enrolledAt.getTime()) return false
  if (/^(mailer-daemon|postmaster|no-?reply|do-?not-?reply)([+@._-]|$)/i.test(from)) return false
  const header = (name: string) => message.headers?.find((h) => h.name.toLowerCase() === name)?.value.trim().toLowerCase() ?? ''
  if (header('auto-submitted') && header('auto-submitted') !== 'no') return false
  if (header('x-autoreply') || header('x-autorespond') || /bulk|list|junk/.test(header('precedence'))) return false
  if (/multipart\/report|delivery-status|disposition-notification/.test(header('content-type'))) return false
  if (/^(automatic reply|auto.?reply|out of office|undeliverable|delivery status notification|returned mail)\b/i.test(message.subject)) return false
  return true
}

/** Replays safely after sync failure: source-key upsert and cadence exits commit together. */
export async function reconcileEmailReplies(organizationId: string, accountId: string, messages: ReplyMessage[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const account = await tx.emailAccount.findFirst({ where: { id: accountId, organizationId } })
    if (!account) throw new AppError('NOT_FOUND', 'Mailbox not found', 404)
    const member = await tx.organizationMember.findUnique({ where: { userId_organizationId: { userId: account.userId, organizationId } } })
    if (!member) return
    for (const message of messages) {
      const fromEmail = message.fromEmail.trim().toLowerCase()
      if (fromEmail === account.email.trim().toLowerCase()) continue
      const leads = await tx.lead.findMany({ where: { organizationId, deletedAt: null, OR: [{ email: { equals: fromEmail, mode: 'insensitive' } }, { altEmail: { equals: fromEmail, mode: 'insensitive' } }] }, take: 2, select: { id: true, firstName: true } })
      if (leads.length !== 1) continue
      const lead = leads[0]
      const enrollments = await tx.cadenceEnrollment.findMany({ where: { organizationId, leadId: lead.id, enrolledById: account.userId, status: { in: ['ACTIVE', 'PAUSED'] }, emailThreadId: message.threadId } })
      const matches = enrollments.filter((enrollment) => isHumanReply(message, account.email, enrollment))
      if (!matches.length) continue
      const sourceKey = JSON.stringify([account.provider, accountId, message.externalId])
      await tx.followUpSuggestion.createMany({ data: { organizationId, assigneeId: account.userId, leadId: lead.id, sourceKey, sourceType: 'EMAIL', sourceId: message.externalId, sourceThreadId: message.threadId, sourceText: message.bodyPreview ?? '', title: `Follow up with ${lead.firstName}`, description: `Reply received: ${message.subject}\n\n${message.bodyPreview ?? ''}`, draftSubject: /^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`, draftBody: `Hi ${lead.firstName},\n\nThank you for your reply. ` }, skipDuplicates: true })
      const result = await tx.cadenceEnrollment.updateMany({ where: { organizationId, id: { in: matches.map((e) => e.id) }, status: { in: ['ACTIVE', 'PAUSED'] } }, data: { status: 'EXITED', exitReason: 'reply_received', completedAt: new Date() } })
      if (result.count) await tx.auditEntry.create({ data: { organizationId, userId: account.userId, action: 'UPDATE', entityType: 'CadenceEnrollment', entityId: lead.id, changes: { reason: 'reply_received', count: result.count } } })
    }
  }, { timeout: 15000 })
}

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
    return lead ? [{ ...row, lead }] : []
  })
}
