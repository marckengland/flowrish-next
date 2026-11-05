import 'server-only'
import { Prisma, type EmailMessage } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/server/db/client'
import { AppError } from '@/lib/errors'
import { mailAddress, normalizeEmail, routingState, type RoutingState } from '@/lib/email-routing'
import { emailMatchChanged, lockEmailMatch, matchEmailLead, routingDigest, type MailLead } from './email-lead-matcher'
import { emailRoutingEnabled } from './email-routing-policy'
import { isHumanReply, type ReplyMessage } from './email-reply-types'

export interface MailboxIdentity { userId: string; email: string; provider: string }
export interface RoutingMailbox extends MailboxIdentity { id: string; organizationId: string }
const replySchema = z.object({ externalId: z.string(), threadId: z.string().nullable(), fromEmail: z.string(), toEmail: z.string(), recipientEmails: z.array(z.string()).optional(), subject: z.string(), bodyPreview: z.string().nullable(), sentAt: z.string(), headers: z.array(z.object({ name: z.string(), value: z.string() })).optional() })
export const sourceChanged = () => new AppError('EMAIL_SOURCE_CHANGED', 'The mailbox or stored message changed. Refresh before continuing.', 409)
export async function routingMailbox(db: Prisma.TransactionClient, organizationId: string, accountId: string, expected?: MailboxIdentity): Promise<RoutingMailbox | null> {
  const select = { id: true, organizationId: true, userId: true, email: true, provider: true }
  const before = await db.emailAccount.findFirst({ where: { id: accountId, organizationId }, select })
  if (!before) throw new AppError('NOT_FOUND', 'Mailbox not found.', 404)
  const member = await db.organizationMember.findUnique({ where: { userId_organizationId: { userId: before.userId, organizationId } } })
  if (!member) return null
  const locked = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM "OrganizationMember" WHERE "organizationId"=${organizationId} AND "userId"=${before.userId} FOR KEY SHARE`
  if (!locked.length) return null
  await db.$queryRaw`SELECT id FROM "EmailAccount" WHERE id=${accountId} AND "organizationId"=${organizationId} FOR SHARE`
  const account = await db.emailAccount.findFirst({ where: { id: accountId, organizationId }, select })
  if (!account || account.userId !== before.userId || normalizeEmail(account.email) !== normalizeEmail(before.email) || account.provider !== before.provider) throw sourceChanged()
  if (expected && (account.userId !== expected.userId || normalizeEmail(account.email) !== normalizeEmail(expected.email) || account.provider !== expected.provider)) throw sourceChanged()
  if (!['gmail', 'microsoft'].includes(account.provider)) throw sourceChanged()
  return account
}
export function storedReply(record: EmailMessage): ReplyMessage | null {
  const parsed = replySchema.safeParse(record.replyMetadata)
  if (!parsed.success) return null
  const value = parsed.data
  if (value.externalId !== record.externalId || value.threadId !== record.threadId || normalizeEmail(value.fromEmail) !== normalizeEmail(record.fromEmail) || normalizeEmail(value.toEmail) !== normalizeEmail(record.toEmail) || value.subject !== record.subject || new Date(value.sentAt).getTime() !== record.sentAt.getTime()) throw sourceChanged()
  return value
}
export function routingAddress(message: ReplyMessage, mailboxEmail: string): string | null {
  const outgoing = normalizeEmail(message.fromEmail) === normalizeEmail(mailboxEmail)
  const recipients = [...new Set((message.recipientEmails ?? [message.toEmail]).map(normalizeEmail).filter(value => value !== normalizeEmail(mailboxEmail)))]
  const address = outgoing ? recipients.length === 1 ? recipients[0] : '' : message.fromEmail
  const parsed = mailAddress.safeParse(address)
  return parsed.success ? parsed.data : null
}
export function boundRouting(record: EmailMessage, account: RoutingMailbox): RoutingState | null {
  if (record.leadRouting === null || record.leadRouting === undefined) return null
  const parsed = routingState.safeParse(record.leadRouting)
  if (!parsed.success || parsed.data.ownerId !== account.userId || parsed.data.mailboxEmail !== normalizeEmail(account.email) || parsed.data.provider !== account.provider) throw sourceChanged()
  return parsed.data
}
export async function saveRouting(db: Prisma.TransactionClient, record: EmailMessage, account: RoutingMailbox, value: Pick<RoutingState, 'state' | 'address'> & Partial<RoutingState>) {
  const data = routingState.parse({ ownerId: account.userId, mailboxEmail: normalizeEmail(account.email), provider: account.provider, at: new Date().toISOString(), ...value })
  await db.emailMessage.update({ where: { id: record.id, organizationId: account.organizationId, accountId: account.id }, data: { leadRouting: data as Prisma.InputJsonValue } })
  return data
}
export async function commitEmailRoute(db: Prisma.TransactionClient, record: EmailMessage, account: RoutingMailbox, message: ReplyMessage, lead: Pick<MailLead, 'id' | 'firstName'>, mode: 'AUTO' | 'MANUAL') {
  const existing = await db.activity.findUnique({ where: { emailMessageId: record.id }, select: { id: true, leadId: true } })
  if (existing && existing.leadId !== lead.id) throw emailMatchChanged()
  if (!existing) await db.activity.create({ data: { organizationId: account.organizationId, type: 'EMAIL', leadId: lead.id, createdById: account.userId, notes: message.subject ? `Email: ${message.subject}` : 'Email', emailMessageId: record.id } })
  const sentAt = new Date(message.sentAt)
  await db.lead.updateMany({ where: { id: lead.id, organizationId: account.organizationId, deletedAt: null, mergedIntoId: null, OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: sentAt } }] }, data: { lastActivityAt: sentAt } })
  let stopped = 0, suggestionCreated = false
  if (normalizeEmail(message.fromEmail) !== normalizeEmail(account.email) && message.threadId) {
    const enrollments = await db.cadenceEnrollment.findMany({ where: { organizationId: account.organizationId, leadId: lead.id, enrolledById: account.userId, status: { in: ['ACTIVE', 'PAUSED'] }, emailThreadId: message.threadId } })
    const matches = enrollments.filter(enrollment => isHumanReply(message, account.email, enrollment))
    if (matches.length) {
      const suggested = await db.followUpSuggestion.createMany({ data: { organizationId: account.organizationId, assigneeId: account.userId, leadId: lead.id, sourceKey: JSON.stringify([account.provider, account.id, message.externalId]), sourceType: 'EMAIL', sourceId: message.externalId, sourceThreadId: message.threadId, sourceText: message.bodyPreview ?? '', title: `Follow up with ${lead.firstName}`, description: `Reply received: ${message.subject}\n\n${message.bodyPreview ?? ''}`, draftSubject: /^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`, draftBody: `Hi ${lead.firstName},\n\nThank you for your reply. `, status: 'PENDING' }, skipDuplicates: true })
      suggestionCreated = suggested.count > 0
      const changed = await db.cadenceEnrollment.updateMany({ where: { organizationId: account.organizationId, id: { in: matches.map(row => row.id) }, status: { in: ['ACTIVE', 'PAUSED'] } }, data: { status: 'EXITED', exitReason: 'reply_received', completedAt: new Date() } })
      stopped = changed.count
      if (stopped) await db.auditEntry.create({ data: { organizationId: account.organizationId, userId: account.userId, action: 'UPDATE', entityType: 'CadenceEnrollment', entityId: lead.id, changes: { reason: 'reply_received', count: stopped } } })
    }
  }
  await db.auditEntry.create({ data: { organizationId: account.organizationId, userId: account.userId, action: 'UPDATE', entityType: 'EmailMessage', entityId: record.id, changes: { reason: 'email_routed', leadId: lead.id, mode, stopped, suggestionCreated } } })
  return { stopped, suggestionCreated }
}
export async function reconcileStoredEmailReplies(organizationId: string, accountId: string, messages: ReplyMessage[], expected?: MailboxIdentity): Promise<void> {
  for (const input of messages) await prisma.$transaction(async db => {
    const account = await routingMailbox(db, organizationId, accountId, expected)
    if (!account) return
    const where = { organizationId_accountId_externalId: { organizationId, accountId, externalId: input.externalId } }
    const record = await db.emailMessage.findUnique({ where })
    if (!record || boundRouting(record, account)) return
    const message = storedReply(record), address = message && routingAddress(message, account.email)
    const existing = await db.activity.findUnique({ where: { emailMessageId: record.id }, select: { id: true, leadId: true } })
    const match = address ? await matchEmailLead(db, organizationId, address) : null
    if (match && address) await lockEmailMatch(db, organizationId, address, match, existing ? [existing.leadId] : [])
    await db.$queryRaw`SELECT id FROM "EmailMessage" WHERE id=${record.id} AND "organizationId"=${organizationId} AND "accountId"=${accountId} FOR UPDATE`
    const current = await db.emailMessage.findUnique({ where })
    if (!current) throw sourceChanged()
    if (boundRouting(current, account)) return
    // A competing message writer can delay this lock while a new address match appears.
    if (match && address && routingDigest(await matchEmailLead(db, organizationId, address)) !== routingDigest(match)) throw emailMatchChanged()
    if (routingDigest(storedReply(current)) !== routingDigest(message)) throw sourceChanged()
    if (!message || !address || !match || !match.targets.length && !match.blocked) { await saveRouting(db, current, account, { state: 'UNMATCHED', address: address ?? '' }); return }
    const reason = !emailRoutingEnabled() ? 'PAUSED' : match.reason ?? (existing && existing.leadId !== match.targets[0]?.id ? 'EXISTING_LINK' : null)
    if (reason) { await saveRouting(db, current, account, { state: 'PENDING', address, reason }); return }
    await commitEmailRoute(db, current, account, message, match.targets[0], 'AUTO')
    await saveRouting(db, current, account, { state: 'ROUTED', address, leadId: match.targets[0].id, mode: 'AUTO' })
  }, { timeout: 20000 })
}
