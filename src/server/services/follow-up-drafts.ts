import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/server/db/client'
import { requireEntitlement } from '@/server/auth/entitlements'
import { fetchEmailConversation, type EmailConversation } from '@/server/services/email-conversation'
import { generateConversationFollowUp } from '@/server/services/ai'
import { AppError } from '@/lib/errors'
import { normalizeEmail, routingState } from '@/lib/email-routing'
import { matchEmailLead } from './email-lead-matcher'
import { currentFollowUpAccess, followUpChanged, followUpLead, lockFollowUpMember, requireFollowUpWrites, safeFollowUp } from './follow-up-access'

const contextSchema = z.object({ accountId: z.string().min(1), provider: z.enum(['gmail', 'microsoft']), threadId: z.string().min(1), recipientEmail: z.string().email(), mailboxEmail: z.string().email(), fingerprint: z.string().min(1), messageCount: z.number().int().positive(), lastMessageAt: z.string().datetime({ offset: true }) })
const instructionsSchema = z.string().max(2000).optional()

async function authorizedSource(organizationId: string, userId: string, id: string, requireAi = false, db: Prisma.TransactionClient = prisma) {
  const { filter } = await currentFollowUpAccess(db, organizationId, userId, true)
  if (requireAi) await requireEntitlement(organizationId, 'ai')
  const suggestion = await db.followUpSuggestion.findFirst({ where: { id, organizationId, assigneeId: userId } })
  if (!suggestion || suggestion.status === 'DISMISSED') throw new AppError('NOT_FOUND', 'Follow-up is no longer available.', 404)
  if (suggestion.sourceType !== 'EMAIL' || !suggestion.sourceThreadId) throw new AppError('INVALID_SOURCE', 'A source email conversation is required.', 400)
  const lead = await db.lead.findFirst({ where: { id: suggestion.leadId, organizationId, mergedIntoId: null, AND: [filter] } })
  if (!lead) throw new AppError('LEAD_NOT_FOUND', 'Lead is no longer available.', 404)
  let key: unknown
  try { key = JSON.parse(suggestion.sourceKey) } catch { throw new AppError('INVALID_SOURCE', 'The source mailbox could not be verified.', 409) }
  const parsedKey = z.tuple([z.enum(['gmail', 'microsoft']), z.string().min(1), z.string().min(1)]).safeParse(key)
  if (!parsedKey.success || parsedKey.data[2] !== suggestion.sourceId) throw new AppError('INVALID_SOURCE', 'The source mailbox could not be verified.', 409)
  const [provider, accountId] = parsedKey.data
  const account = await db.emailAccount.findFirst({ where: { id: accountId, organizationId, userId, provider }, select: { id: true, userId: true, email: true, provider: true } })
  const message = await db.emailMessage.findFirst({ where: { organizationId, accountId, externalId: suggestion.sourceId, threadId: suggestion.sourceThreadId }, select: { id: true, fromEmail: true, leadRouting: true, activity: { select: { leadId: true, organizationId: true } } } })
  if (!account || !message || message.activity?.leadId !== lead.id || message.activity.organizationId !== organizationId) throw new AppError('INVALID_SOURCE', 'The source mailbox or message is no longer available.', 409)
  if (message.leadRouting != null) {
    const binding = routingState.safeParse(message.leadRouting)
    if (!binding.success || binding.data.state !== 'ROUTED' || binding.data.ownerId !== userId || binding.data.mailboxEmail !== normalizeEmail(account.email) || binding.data.provider !== provider || binding.data.leadId !== lead.id) throw new AppError('INVALID_SOURCE', 'The stored mailbox association changed. Refresh before continuing.', 409)
  }
  const leadEmails = [lead.email, lead.altEmail].filter((email): email is string => Boolean(email)).map((email) => email.trim().toLowerCase())
  let verifiedAlias = false
  if (message.fromEmail && normalizeEmail(message.fromEmail) !== normalizeEmail(account.email) && !leadEmails.includes(normalizeEmail(message.fromEmail))) {
    const invalid = () => new AppError('INVALID_SOURCE', 'The source address is no longer linked to this lead. Review the email match before drafting.', 409)
    const proof = routingState.safeParse(message.leadRouting), address = normalizeEmail(message.fromEmail)
    if (!proof.success || proof.data.state !== 'ROUTED' || proof.data.ownerId !== userId || proof.data.mailboxEmail !== normalizeEmail(account.email) || proof.data.provider !== provider || proof.data.address !== address || proof.data.leadId !== lead.id || message.activity?.leadId !== lead.id || message.activity.organizationId !== organizationId) throw invalid()
    const match = await matchEmailLead(db, organizationId, address)
    if (['LIMIT', 'UNAVAILABLE'].includes(match.reason ?? '') || !match.targets.some(row => row.id === lead.id)) throw invalid()
    leadEmails.push(address)
    verifiedAlias = true
  }
  return { suggestion, accountId, provider, leadEmails, verifiedAlias, mailboxEmail: account.email, primaryEmail: lead.email, messageId: message.id }
}

function canonicalReplySubject(conversation: EmailConversation): string {
  const subject = conversation.subject.trim()
  const canonical = /^re:/i.test(subject) ? subject : `Re: ${subject}`
  if (!subject || /[\r\n]/.test(subject) || canonical.length > 200) throw new AppError('INVALID_SOURCE', 'The source conversation subject cannot be used for a contextual reply.', 409)
  return canonical
}

function metadata(conversation: EmailConversation) {
  return contextSchema.parse({ accountId: conversation.accountId, provider: conversation.provider, threadId: conversation.threadId, recipientEmail: conversation.recipientEmail, mailboxEmail: conversation.mailboxEmail, fingerprint: conversation.fingerprint, messageCount: conversation.messages.length, lastMessageAt: conversation.messages.at(-1)?.sentAt })
}

function publicContext(context: z.infer<typeof contextSchema>) {
  const { fingerprint: _fingerprint, ...safe } = context
  return safe
}

function sameSource(before: Awaited<ReturnType<typeof authorizedSource>>, current: Awaited<ReturnType<typeof authorizedSource>>) {
  if (before.suggestion.updatedAt.getTime() !== current.suggestion.updatedAt.getTime() || before.suggestion.draftVersion !== current.suggestion.draftVersion || before.suggestion.leadId !== current.suggestion.leadId || before.suggestion.sourceKey !== current.suggestion.sourceKey || before.suggestion.sourceThreadId !== current.suggestion.sourceThreadId || before.accountId !== current.accountId || before.provider !== current.provider) throw followUpChanged()
}
function conversationSource(source: Awaited<ReturnType<typeof authorizedSource>>, conversation: EmailConversation) {
  if (normalizeEmail(source.mailboxEmail) !== normalizeEmail(conversation.mailboxEmail) || !source.leadEmails.includes(normalizeEmail(conversation.recipientEmail))) throw new AppError('INVALID_SOURCE', 'The conversation or recipient is no longer available. Review the source again.', 409)
}
export async function generateFollowUpDraft(organizationId: string, userId: string, id: string, instructions?: string) {
  const checkedInstructions = instructionsSchema.parse(instructions)
  requireFollowUpWrites()
  const source = await authorizedSource(organizationId, userId, id, true)
  const conversation = await fetchEmailConversation({ accountId: source.accountId, organizationId, userId, threadId: source.suggestion.sourceThreadId!, sourceMessageId: source.suggestion.sourceId, leadEmails: source.leadEmails })
  const subject = canonicalReplySubject(conversation)
  const beforeAi = await authorizedSource(organizationId, userId, id, true)
  sameSource(source, beforeAi); conversationSource(beforeAi, conversation)
  const generated = await generateConversationFollowUp(conversation, checkedInstructions, organizationId)
  const context = metadata(conversation), generatedAt = new Date(), version = randomUUID()
  await safeFollowUp(() => prisma.$transaction(async db => {
    await lockFollowUpMember(db, organizationId, userId)
    await db.$queryRaw`SELECT id FROM "EmailAccount" WHERE id=${source.accountId} AND "organizationId"=${organizationId} AND "userId"=${userId} FOR SHARE`
    await db.$queryRaw`SELECT id FROM "Lead" WHERE id=${source.suggestion.leadId} AND "organizationId"=${organizationId} FOR SHARE`
    await db.$queryRaw`SELECT id FROM "EmailMessage" WHERE id=${source.messageId} AND "organizationId"=${organizationId} FOR SHARE`
    await db.$queryRaw`SELECT id FROM "FollowUpSuggestion" WHERE id=${id} AND "organizationId"=${organizationId} AND "assigneeId"=${userId} FOR UPDATE`
    const current = await authorizedSource(organizationId, userId, id, true, db)
    sameSource(source, current); conversationSource(current, conversation)
    const written = await db.followUpSuggestion.updateMany({ where: { id, organizationId, assigneeId: userId, updatedAt: source.suggestion.updatedAt, draftVersion: source.suggestion.draftVersion, status: { not: 'DISMISSED' } }, data: { draftSubject: subject, draftBody: generated.body, draftGeneratedAt: generatedAt, draftVersion: version, draftContext: context } })
    if (!written.count) throw new AppError('DRAFT_CONFLICT', 'This follow-up changed while the draft was generated. Refresh and try again.', 409)
    const final = await authorizedSource(organizationId, userId, id, true, db)
    conversationSource(final, conversation)
  }, { timeout: 20000 }))
  return { id, subject, body: generated.body, generatedAt: generatedAt.toISOString(), version, context: publicContext(context) }
}

export async function prepareFollowUpSend(organizationId: string, userId: string, id: string, version: string, leadId: string) {
  requireFollowUpWrites()
  const source = await authorizedSource(organizationId, userId, id)
  if (source.suggestion.leadId !== leadId) throw new AppError('INVALID_SOURCE', 'The draft does not belong to this lead.', 409)
  if (source.suggestion.draftVersion !== version || !source.suggestion.draftGeneratedAt) throw new AppError('DRAFT_CONFLICT', 'This draft is outdated. Generate it again before sending.', 409)
  const parsed = contextSchema.safeParse(source.suggestion.draftContext)
  if (!parsed.success) throw new AppError('DRAFT_CONFLICT', 'The draft source is unavailable. Generate it again.', 409)
  const saved = parsed.data
  if (saved.accountId !== source.accountId || saved.provider !== source.provider || saved.threadId !== source.suggestion.sourceThreadId) throw new AppError('DRAFT_CONFLICT', 'The draft source changed. Generate it again.', 409)
  const conversation = await fetchEmailConversation({ accountId: source.accountId, organizationId, userId, threadId: saved.threadId, sourceMessageId: source.suggestion.sourceId, leadEmails: source.leadEmails })
  const current = metadata(conversation)
  if (current.fingerprint !== saved.fingerprint || current.recipientEmail !== saved.recipientEmail || current.mailboxEmail !== saved.mailboxEmail) throw new AppError('DRAFT_CONFLICT', 'The conversation changed. Generate a new draft before sending.', 409)
  const latest = await authorizedSource(organizationId, userId, id)
  conversationSource(latest, conversation)
  if (latest.suggestion.draftVersion !== version || latest.suggestion.updatedAt.getTime() !== source.suggestion.updatedAt.getTime()) throw new AppError('DRAFT_CONFLICT', 'This draft changed. Refresh before sending.', 409)
  const lastMessage = conversation.messages.at(-1)
  const replyMessageId = lastMessage?.messageId
  if (saved.provider === 'gmail' && (!replyMessageId || replyMessageId.length > 998 || !/^<[^<>\s@]+@[^<>\s@]+>$/.test(replyMessageId))) throw new AppError('DRAFT_CONFLICT', 'The source email does not have a valid reply header. A contextual reply cannot be sent.', 409)
  const replyReferences = replyMessageId ? [lastMessage?.references, replyMessageId].filter(Boolean).join(' ') : undefined
  return { threadId: saved.threadId, subject: canonicalReplySubject(conversation), options: { accountId: saved.accountId, recipientEmail: saved.recipientEmail, reviewedFollowUp: { id, version }, ...(replyMessageId ? { replyMessageId, replyReferences } : {}) } }
}

// Revalidate source proof at the transport boundary, including after token refresh.
// This performs only database reads; provider conversation checks remain in prepare.
export async function verifyFollowUpRecipient(organizationId: string, userId: string, leadId: string, threadId: string | undefined, accountId: string | undefined, recipientEmail: string, reviewed: { id: string; version: string }) {
  requireFollowUpWrites()
  const source = await authorizedSource(organizationId, userId, reviewed.id)
  const parsed = contextSchema.safeParse(source.suggestion.draftContext)
  if (source.suggestion.leadId !== leadId || source.suggestion.draftVersion !== reviewed.version || !source.suggestion.draftGeneratedAt || !parsed.success || parsed.data.accountId !== accountId || parsed.data.accountId !== source.accountId || parsed.data.provider !== source.provider || normalizeEmail(parsed.data.mailboxEmail) !== normalizeEmail(source.mailboxEmail) || parsed.data.threadId !== threadId || parsed.data.threadId !== source.suggestion.sourceThreadId || normalizeEmail(parsed.data.recipientEmail) !== normalizeEmail(recipientEmail) || !source.leadEmails.includes(normalizeEmail(recipientEmail))) throw new AppError('INVALID_RECIPIENT', 'The reviewed recipient or draft changed. Review the conversation again before sending.', 409)
}

export async function prepareFollowUpTemplateSend(organizationId: string, userId: string, id: string, leadId: string) {
  requireFollowUpWrites()
  const source = await authorizedSource(organizationId, userId, id)
  if (source.suggestion.leadId !== leadId) throw new AppError('INVALID_SOURCE', 'This template no longer belongs to the lead.', 409)
  const recipient = z.string().trim().toLowerCase().email().safeParse(source.primaryEmail)
  if (!recipient.success) throw new AppError('LEAD_NO_EMAIL', 'The lead needs a valid primary email for a new template email.', 400)
  return { options: { accountId: source.accountId, recipientEmail: recipient.data, followUpTemplateId: id } }
}
export async function verifyFollowUpTemplate(organizationId: string, userId: string, id: string, leadId: string, accountId: string | undefined, recipientEmail: string, threadId?: string) {
  const source = await prepareFollowUpTemplateSend(organizationId, userId, id, leadId)
  if (threadId || source.options.accountId !== accountId || source.options.recipientEmail !== normalizeEmail(recipientEmail)) throw new AppError('INVALID_SOURCE', 'This template source changed. Refresh before sending a new email.', 409)
}
export async function authorizeManualEmail(organizationId: string, userId: string, leadId: string) {
  requireFollowUpWrites()
  return (await safeFollowUp(() => followUpLead(prisma, organizationId, userId, leadId, true))).lead
}
