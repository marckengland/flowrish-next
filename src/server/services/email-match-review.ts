import 'server-only'
import { Prisma, type EmailMessage } from '@prisma/client'
import { prisma } from '@/server/db/client'
import { AppError } from '@/lib/errors'
import { emailMatchAction, emailMatchPreview, emailMatchListItem, type EmailMatchAction, type RoutingState } from '@/lib/email-routing'
import { requirePermission } from '@/server/auth/permissions'
import { getLeadAccessFilter } from './access'
import { boundRouting, commitEmailRoute, routingMailbox, saveRouting, storedReply, routingAddress, type RoutingMailbox } from './email-routing'
import { emailMatchChanged, lockEmailMatch, matchEmailLead, routingDigest } from './email-lead-matcher'
import { emailRoutingEnabled } from './email-routing-policy'

async function access(db: Prisma.TransactionClient, organizationId: string, userId: string, write = false) {
  const user = await db.user.findUnique({ where: { id: userId }, include: { organizationMemberships: true, teamMemberships: { where: { team: { organizationId } }, include: { team: true, role: { include: { permissions: true } } } } } })
  if (!user || !user.organizationMemberships.some(row => row.organizationId === organizationId)) throw new AppError('FORBIDDEN', 'Current business membership is required.', 403)
  requirePermission(user, 'leads:read')
  if (write) requirePermission(user, 'leads:write')
  return getLeadAccessFilter(user, organizationId)
}
const missing = () => new AppError('NOT_FOUND', 'Message review is no longer available.', 404)
function wire(record: EmailMessage, account: RoutingMailbox, routing: RoutingState) {
  return emailMatchListItem.parse({ id: record.id, fromEmail: record.fromEmail, subject: record.subject, bodyPreview: record.bodyPreview, sentAt: record.sentAt.toISOString(), mailboxEmail: account.email, reason: routing.reason ?? 'REVIEW' })
}
async function owned(db: Prisma.TransactionClient, organizationId: string, userId: string, id: string) {
  const record = await db.emailMessage.findFirst({ where: { id, organizationId } })
  if (!record?.accountId) throw missing()
  const account = await routingMailbox(db, organizationId, record.accountId)
  if (!account || account.userId !== userId) throw missing()
  const routing = boundRouting(record, account)
  if (!routing) throw missing()
  return { record, account, routing }
}
async function snapshot(db: Prisma.TransactionClient, organizationId: string, userId: string, value: Awaited<ReturnType<typeof owned>>, write = false) {
  const { record, account, routing } = value
  if (routing.state !== 'PENDING') throw emailMatchChanged()
  const message = storedReply(record)
  if (!message || routingAddress(message, account.email) !== routing.address) throw emailMatchChanged()
  const match = await matchEmailLead(db, organizationId, routing.address)
  const activity = await db.activity.findUnique({ where: { emailMessageId: record.id }, select: { id: true, leadId: true } })
  const filter = await access(db, organizationId, userId, write)
  const visible = await db.lead.findMany({ where: { organizationId, id: { in: match.targets.map(row => row.id) }, mergedIntoId: null, AND: [filter] }, select: { id: true }, orderBy: { id: 'asc' } })
  const visibleIds = new Set(visible.map(row => row.id))
  const blocked = match.reason === 'LIMIT' || match.reason === 'UNAVAILABLE'
  const candidates = match.targets.filter(row => visibleIds.has(row.id)).slice(0, 20).map(row => ({ id: row.id, label: `${row.firstName} ${row.lastName}`.trim(), email: row.email, canLink: !blocked && (!activity || activity.leadId === row.id), viaArchive: match.sources.some(source => source.mergedIntoId === row.id) }))
  const version = routingDigest({ record: { id: record.id, accountId: record.accountId, message, routing }, match, visible: [...visibleIds].sort(), activity })
  const preview = emailMatchPreview.parse({ message: wire(record, account, routing), candidates, version, blocked, restrictedMatches: match.targets.some(row => !visibleIds.has(row.id)) || match.targets.length > 20 })
  return { preview, match, activity, message }
}
export async function listEmailMatches(organizationId: string, userId: string) {
  return prisma.$transaction(async db => {
    await access(db, organizationId, userId)
    const accounts = await db.emailAccount.findMany({ where: { organizationId, userId }, select: { id: true, organizationId: true, userId: true, email: true, provider: true } })
    const records = await db.emailMessage.findMany({ where: { organizationId, accountId: { in: accounts.map(account => account.id) }, leadRouting: { path: ['state'], equals: 'PENDING' } }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 100 })
    const result = []
    for (const record of records) {
      const account = accounts.find(row => row.id === record.accountId)
      if (!account || account.userId !== userId) continue
      const routing = boundRouting(record, account)
      if (routing?.state === 'PENDING') result.push(wire(record, account, routing))
    }
    return result
  }, { timeout: 20000 })
}
export async function previewEmailMatch(organizationId: string, userId: string, id: string) {
  return prisma.$transaction(async db => {
    const value = await owned(db, organizationId, userId, id)
    return (await snapshot(db, organizationId, userId, value)).preview
  }, { timeout: 20000 })
}
function sameReceipt(routing: RoutingState, action: EmailMatchAction) {
  const receipt = routing.receipt
  return receipt && receipt.requestId === action.requestId && receipt.expectedVersion === action.expectedVersion && receipt.action === action.action && receipt.selectedLeadId === (action.action === 'link' ? action.leadId : undefined) ? receipt.result : null
}
export async function resolveEmailMatch(organizationId: string, userId: string, id: string, raw: unknown) {
  const action = emailMatchAction.parse(raw)
  if (!emailRoutingEnabled()) throw new AppError('EMAIL_ROUTING_DISABLED', 'Email matching is temporarily paused. Your pending reviews are retained.', 503)
  return prisma.$transaction(async db => {
    let value = await owned(db, organizationId, userId, id)
    await access(db, organizationId, userId, true)
    if (value.routing.state === 'PENDING') {
      const before = await snapshot(db, organizationId, userId, value, true)
      await lockEmailMatch(db, organizationId, value.routing.address, before.match, before.activity ? [before.activity.leadId] : [], false)
    }
    await db.$queryRaw`SELECT id FROM "EmailMessage" WHERE id=${id} AND "organizationId"=${organizationId} AND "accountId"=${value.account.id} FOR UPDATE`
    value = await owned(db, organizationId, userId, id)
    const filter = await access(db, organizationId, userId, true)
    if (value.routing.state !== 'PENDING') {
      const result = sameReceipt(value.routing, action)
      if (!result) throw emailMatchChanged()
      if (result.leadId) {
        const activity = await db.activity.findUnique({ where: { emailMessageId: id }, select: { leadId: true } })
        const currentId = activity?.leadId ?? result.leadId
        const allowed = await db.lead.findMany({ where: { organizationId, id: currentId, mergedIntoId: null, AND: [filter] }, select: { id: true } })
        if (!allowed.some(row => row.id === currentId)) throw missing()
        return { ...result, leadId: currentId }
      }
      return result
    }
    const current = await snapshot(db, organizationId, userId, value, true)
    if (current.preview.version !== action.expectedVersion) throw emailMatchChanged()
    const lead = action.action === 'link' ? current.match.targets.find(row => row.id === action.leadId && current.preview.candidates.some(candidate => candidate.id === row.id && candidate.canLink)) : null
    if (action.action === 'link' && !lead) throw emailMatchChanged()
    const effects = lead ? await commitEmailRoute(db, value.record, value.account, current.message, lead, 'MANUAL') : { stopped: 0, suggestionCreated: false }
    if (!lead) await db.auditEntry.create({ data: { organizationId, userId, action: 'UPDATE', entityType: 'EmailMessage', entityId: id, changes: { reason: 'email_match_dismissed' } } })
    // Workflow uniqueness and enrollment updates can wait after the preview.
    // Recheck permission before committing; revocation rolls back all effects.
    const finalFilter = await access(db, organizationId, userId, true)
    if (lead) {
      const allowed = await db.lead.findMany({ where: { organizationId, id: lead.id, mergedIntoId: null, AND: [finalFilter] }, select: { id: true } })
      if (!allowed.some(row => row.id === lead.id)) throw emailMatchChanged()
    }
    const result = { messageId: id, requestId: action.requestId, action: action.action, leadId: lead?.id ?? null, ...effects }
    await saveRouting(db, value.record, value.account, { state: lead ? 'ROUTED' : 'DISMISSED', address: value.routing.address, ...(lead ? { leadId: lead.id, mode: 'MANUAL' as const } : {}), receipt: { requestId: action.requestId, expectedVersion: action.expectedVersion, action: action.action, ...(action.action === 'link' ? { selectedLeadId: action.leadId } : {}), result } })
    return result
  }, { timeout: 20000 })
}
