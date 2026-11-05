import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { prisma } from '@/server/db/client'
import { requirePermission } from '@/server/auth/permissions'
import { requireEntitlement } from '@/server/auth/entitlements'
import { getLeadAccessFilter } from '@/server/services/access'
import { fetchEmailConversation, type EmailConversation } from '@/server/services/email-conversation'
import { generateConversationFollowUp } from '@/server/services/ai'
import { AppError } from '@/lib/errors'
import { normalizeEmail, routingState } from '@/lib/email-routing'
import { matchEmailLead } from './email-lead-matcher'

const contextSchema = z.object({ accountId: z.string().min(1), provider: z.enum(['gmail', 'microsoft']), threadId: z.string().min(1), recipientEmail: z.string().email(), mailboxEmail: z.string().email(), fingerprint: z.string().min(1), messageCount: z.number().int().positive(), lastMessageAt: z.string().datetime({ offset: true }) })
const instructionsSchema = z.string().max(2000).optional()

async function authorizedSource(organizationId: string, userId: string, id: string, requireAi = false) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { organizationMemberships: true, teamMemberships: { where: { team: { organizationId } }, include: { team: true, role: { include: { permissions: true } } } } } })
  if (!user || !user.organizationMemberships.some((member) => member.organizationId === organizationId)) throw new AppError('FORBIDDEN', 'Current organization membership is required.', 403)
  requirePermission(user, 'leads:read')
  requirePermission(user, 'leads:write')
  if (requireAi) await requireEntitlement(organizationId, 'ai')
  const suggestion = await prisma.followUpSuggestion.findFirst({ where: { id, organizationId, assigneeId: userId } })
  if (!suggestion || suggestion.status === 'DISMISSED') throw new AppError('NOT_FOUND', 'Follow-up is no longer available.', 404)
  if (suggestion.sourceType !== 'EMAIL' || !suggestion.sourceThreadId) throw new AppError('INVALID_SOURCE', 'A source email conversation is required.', 400)
  const filter = await getLeadAccessFilter(user, organizationId)
  const lead = await prisma.lead.findFirst({ where: { id: suggestion.leadId, organizationId, ...filter } })
  if (!lead) throw new AppError('LEAD_NOT_FOUND', 'Lead is no longer available.', 404)
  let key: unknown
  try { key = JSON.parse(suggestion.sourceKey) } catch { throw new AppError('INVALID_SOURCE', 'The source mailbox could not be verified.', 409) }
  const parsedKey = z.tuple([z.enum(['gmail', 'microsoft']), z.string().min(1), z.string().min(1)]).safeParse(key)
  if (!parsedKey.success || parsedKey.data[2] !== suggestion.sourceId) throw new AppError('INVALID_SOURCE', 'The source mailbox could not be verified.', 409)
  const [provider, accountId] = parsedKey.data
  const account = await prisma.emailAccount.findFirst({ where: { id: accountId, organizationId, userId, provider }, select: { id: true, userId: true, email: true, provider: true } })
  const message = await prisma.emailMessage.findFirst({ where: { organizationId, accountId, externalId: suggestion.sourceId, threadId: suggestion.sourceThreadId }, select: { id: true, fromEmail: true, leadRouting: true, activity: { select: { leadId: true, organizationId: true } } } })
  if (!account || !message) throw new AppError('INVALID_SOURCE', 'The source mailbox or message is no longer available.', 409)
  const leadEmails = [lead.email, lead.altEmail].filter((email): email is string => Boolean(email)).map((email) => email.trim().toLowerCase())
  let verifiedAlias = false
  if (message.fromEmail && normalizeEmail(message.fromEmail) !== normalizeEmail(account.email) && !leadEmails.includes(normalizeEmail(message.fromEmail))) {
    const invalid = () => new AppError('INVALID_SOURCE', 'The source address is no longer linked to this lead. Review the email match before drafting.', 409)
    const proof = routingState.safeParse(message.leadRouting), address = normalizeEmail(message.fromEmail)
    if (!proof.success || proof.data.state !== 'ROUTED' || proof.data.ownerId !== userId || proof.data.mailboxEmail !== normalizeEmail(account.email) || proof.data.provider !== provider || proof.data.address !== address || proof.data.leadId !== lead.id || message.activity?.leadId !== lead.id || message.activity.organizationId !== organizationId) throw invalid()
    const match = await matchEmailLead(prisma, organizationId, address)
    if (['LIMIT', 'UNAVAILABLE'].includes(match.reason ?? '') || !match.targets.some(row => row.id === lead.id)) throw invalid()
    leadEmails.push(address)
    verifiedAlias = true
  }
  return { suggestion, accountId, provider, leadEmails, verifiedAlias }
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

export async function generateFollowUpDraft(organizationId: string, userId: string, id: string, instructions?: string) {
  const checkedInstructions = instructionsSchema.parse(instructions)
  const source = await authorizedSource(organizationId, userId, id, true)
  const conversation = await fetchEmailConversation({ accountId: source.accountId, organizationId, userId, threadId: source.suggestion.sourceThreadId!, sourceMessageId: source.suggestion.sourceId, leadEmails: source.leadEmails })
  const subject = canonicalReplySubject(conversation)
  const generated = await generateConversationFollowUp(conversation, checkedInstructions, organizationId)
  const context = metadata(conversation)
  // Recheck access after network calls; dismissal and newer drafts also change
  // updatedAt, which is used as the optimistic write fence below.
  await authorizedSource(organizationId, userId, id, true)
  const generatedAt = new Date()
  const version = randomUUID()
  const written = await prisma.followUpSuggestion.updateMany({ where: { id, organizationId, assigneeId: userId, updatedAt: source.suggestion.updatedAt, draftVersion: source.suggestion.draftVersion, status: { not: 'DISMISSED' } }, data: { draftSubject: subject, draftBody: generated.body, draftGeneratedAt: generatedAt, draftVersion: version, draftContext: context } })
  if (!written.count) throw new AppError('DRAFT_CONFLICT', 'This follow-up changed while the draft was generated. Refresh and try again.', 409)
  return { id, subject, body: generated.body, generatedAt: generatedAt.toISOString(), version, context: publicContext(context) }
}

export async function prepareFollowUpSend(organizationId: string, userId: string, id: string, version: string, leadId: string) {
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
  if (latest.suggestion.draftVersion !== version || latest.suggestion.updatedAt.getTime() !== source.suggestion.updatedAt.getTime()) throw new AppError('DRAFT_CONFLICT', 'This draft changed. Refresh before sending.', 409)
  const lastMessage = conversation.messages.at(-1)
  const replyMessageId = lastMessage?.messageId
  if (saved.provider === 'gmail' && (!replyMessageId || replyMessageId.length > 998 || !/^<[^<>\s@]+@[^<>\s@]+>$/.test(replyMessageId))) throw new AppError('DRAFT_CONFLICT', 'The source email does not have a valid reply header. A contextual reply cannot be sent.', 409)
  const replyReferences = replyMessageId ? [lastMessage?.references, replyMessageId].filter(Boolean).join(' ') : undefined
  return { threadId: saved.threadId, subject: canonicalReplySubject(conversation), options: { accountId: saved.accountId, recipientEmail: saved.recipientEmail, ...(source.verifiedAlias ? { reviewedFollowUp: { id, version } } : {}), ...(replyMessageId ? { replyMessageId, replyReferences } : {}) } }
}

// Revalidate source proof at the transport boundary, including after token refresh.
// This performs only database reads; provider conversation checks remain in prepare.
export async function verifyFollowUpRecipient(organizationId: string, userId: string, leadId: string, threadId: string | undefined, accountId: string | undefined, recipientEmail: string, reviewed: { id: string; version: string }) {
  const source = await authorizedSource(organizationId, userId, reviewed.id)
  const parsed = contextSchema.safeParse(source.suggestion.draftContext)
  if (!source.verifiedAlias || source.suggestion.leadId !== leadId || source.suggestion.draftVersion !== reviewed.version || !source.suggestion.draftGeneratedAt || !parsed.success || parsed.data.accountId !== accountId || parsed.data.accountId !== source.accountId || parsed.data.provider !== source.provider || parsed.data.threadId !== threadId || parsed.data.threadId !== source.suggestion.sourceThreadId || normalizeEmail(parsed.data.recipientEmail) !== normalizeEmail(recipientEmail) || !source.leadEmails.includes(normalizeEmail(recipientEmail))) throw new AppError('INVALID_RECIPIENT', 'The reviewed recipient or draft changed. Review the conversation again before sending.', 409)
}
