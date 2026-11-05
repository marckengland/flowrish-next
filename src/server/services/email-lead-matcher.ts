import 'server-only'
import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { AppError } from '@/lib/errors'
import { mailAddress } from '@/lib/email-routing'
const select = { id: true, firstName: true, lastName: true, email: true, altEmail: true, assignedUserId: true, mergedIntoId: true, deletedAt: true, updatedAt: true } satisfies Prisma.LeadSelect
export type MailLead = Prisma.LeadGetPayload<{ select: typeof select }>
export interface EmailLeadMatch { sources: MailLead[]; targets: MailLead[]; blocked: boolean; reason: 'AMBIGUOUS' | 'UNAVAILABLE' | 'LIMIT' | null }
export const emailMatchChanged = () => new AppError('EMAIL_MATCH_CHANGED', 'The message, matches or access changed. Refresh and review again.', 409)
export const routingDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export async function matchEmailLead(db: Prisma.TransactionClient, organizationId: string, rawAddress: string): Promise<EmailLeadMatch> {
  const address = mailAddress.parse(rawAddress)
  const found = await db.lead.findMany({ where: { organizationId, AND: [
    { OR: [{ email: { equals: address, mode: 'insensitive' } }, { altEmail: { equals: address, mode: 'insensitive' } }] },
    { OR: [{ deletedAt: null, mergedIntoId: null }, { deletedAt: { not: null }, mergedIntoId: { not: null } }] },
  ] }, select, orderBy: { id: 'asc' }, take: 201 })
  const sources = found.slice(0, 200)
  const ids = [...new Set(sources.map(row => row.mergedIntoId ?? row.id))].sort()
  const targets = ids.length ? await db.lead.findMany({ where: { organizationId, id: { in: ids }, deletedAt: null, mergedIntoId: null }, select, orderBy: { id: 'asc' } }) : []
  const missing = ids.some(id => !targets.some(row => row.id === id))
  const reason = found.length > 200 ? 'LIMIT' : missing ? 'UNAVAILABLE' : targets.length > 1 ? 'AMBIGUOUS' : null
  return { sources, targets, blocked: reason !== null, reason }
}
export async function lockEmailMatch(db: Prisma.TransactionClient, organizationId: string, address: string, before: EmailLeadMatch, extraIds: string[] = [], verify = true) {
  const ids = [...new Set([...before.sources.map(row => row.id), ...before.targets.map(row => row.id), ...extraIds])].sort()
  if (ids.length) await db.$queryRaw(Prisma.sql`SELECT id FROM "Lead" WHERE "organizationId"=${organizationId} AND id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`)
  const current = await matchEmailLead(db, organizationId, address)
  if (verify && routingDigest(before) !== routingDigest(current)) throw emailMatchChanged()
  return current
}
