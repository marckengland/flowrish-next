import 'server-only'
import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'
import { prisma } from '@/server/db/client'
import { AppError } from '@/lib/errors'
import { mailAddress } from '@/lib/email-routing'
import { contactPreferenceInput } from '@/lib/contact-preferences'
import { hasPermission, requirePermission } from '@/server/auth/permissions'
import { followUpLead, lockFollowUpMember } from './follow-up-access'
import { contactPolicyAvailable } from './contact-policy'

const conflict = () => new AppError('CONTACT_PREFERENCE_CHANGED', 'Contact preferences changed. Refresh and review them again.', 409)
export function requireContactPolicy() { if (!contactPolicyAvailable()) throw new AppError('CONTACT_POLICY_PAUSED', 'Contact preference writes and lead outreach are temporarily paused.', 503) }
async function safe<T>(run: () => Promise<T>) { try { return await run() } catch (error) { if (error instanceof AppError || error instanceof ZodError) throw error; throw new AppError('CONTACT_POLICY_UNAVAILABLE', 'Contact restrictions could not be verified. Refresh the status before continuing.', 503) } }
async function addresses(db: Prisma.TransactionClient, organizationId: string, leadId: string, explicitRecipient?: string) {
  const lead = await db.lead.findFirst({ where: { id: leadId, organizationId, deletedAt: null, mergedIntoId: null } })
  if (!lead) throw new AppError('LEAD_NOT_FOUND', 'Lead is no longer available.', 404)
  const archived = await db.lead.findMany({ where: { organizationId, mergedIntoId: leadId }, select: { email: true, altEmail: true }, orderBy: { id: 'asc' }, take: 201 })
  if (archived.length > 200) throw new AppError('CONTACT_ADDRESS_LIMIT', 'This lead has too many archived addresses for a safe review. Ask an administrator.', 409)
  const emails = [...new Set([lead, ...archived].flatMap(row => [row.email, row.altEmail]).concat(explicitRecipient ? [explicitRecipient] : []).filter((value): value is string => Boolean(value?.trim())).map(value => mailAddress.parse(value)))].sort()
  return { emails, stamp: JSON.stringify([lead.id, lead.updatedAt, emails]) }
}
async function restrictions(db: Prisma.TransactionClient, organizationId: string, emails: string[]) { return db.contactSuppression.findMany({ where: { organizationId, email: { in: emails } }, orderBy: { email: 'asc' } }) }
export async function assertContactAllowed(organizationId: string, leadId: string, recipientEmail?: string, db: Prisma.TransactionClient = prisma) {
  requireContactPolicy()
  return safe(async () => {
    const known = await addresses(db, organizationId, leadId, recipientEmail)
    if ((await restrictions(db, organizationId, known.emails)).some(row => row.blocked)) throw new AppError('CONTACT_BLOCKED', 'Do not contact is active for this lead or email address. Email outreach is blocked in this workspace.', 403)
  })
}
export async function lockContactPolicy(db: Prisma.TransactionClient, organizationId: string) { await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`flowrish:contact:${organizationId}`},0))::text` }
export async function withContactEnrollment<T>(organizationId: string, run: (db: Prisma.TransactionClient) => Promise<T>) {
  requireContactPolicy()
  return safe(() => prisma.$transaction(async db => { await lockContactPolicy(db, organizationId); return run(db) }, { timeout: 20000 }))
}
async function snapshot(db: Prisma.TransactionClient, organizationId: string, userId: string, leadId: string, write = false) {
  const { access } = await followUpLead(db, organizationId, userId, leadId, write)
  const known = await addresses(db, organizationId, leadId), rows = await restrictions(db, organizationId, known.emails)
  const user = await db.user.findUnique({ where: { id: userId }, include: { organizationMemberships: true, teamMemberships: { where: { team: { organizationId } }, include: { team: true, role: { include: { permissions: true } } } } } })
  if (!user || !user.organizationMemberships.some(row => row.organizationId === organizationId)) throw new AppError('FORBIDDEN', 'Current business membership is required.', 403)
  requirePermission(user, 'leads:read'); if (write) requirePermission(user, 'leads:write')
  const byEmail = new Map(rows.map(row => [row.email, row]))
  const view = { version: createHash('sha256').update(JSON.stringify([known.stamp, rows.map(row => [row.email, row.revision, row.blocked])])).digest('hex'), canBlock: access.canWrite && hasPermission(user, 'leads:write'), canUnblock: access.canWrite && hasPermission(user, 'leads:delete'), addresses: known.emails.map(email => { const row = byEmail.get(email); return { email, blocked: row?.blocked ?? false, reason: row?.reason ?? null, revision: row?.revision ?? 0, updatedById: row?.updatedById ?? null, updatedAt: row?.updatedAt.toISOString() ?? null } }) }
  return { view, stamp: known.stamp }
}
export async function readContactPreferences(organizationId: string, userId: string, leadId: string) {
  return safe(() => prisma.$transaction(async db => { await lockFollowUpMember(db, organizationId, userId); const result = await snapshot(db, organizationId, userId, leadId); await followUpLead(db, organizationId, userId, leadId); return result.view }, { timeout: 20000 }))
}
export async function changeContactPreference(organizationId: string, userId: string, leadId: string, raw: unknown) {
  const input = contactPreferenceInput.parse(raw)
  requireContactPolicy()
  return safe(() => prisma.$transaction(async db => {
    await lockFollowUpMember(db, organizationId, userId); await lockContactPolicy(db, organizationId)
    const before = await snapshot(db, organizationId, userId, leadId, true)
    if (before.view.version !== input.expectedVersion || !before.view.addresses.some(row => row.email === input.email)) throw conflict()
    if (input.action === 'unblock' && !before.view.canUnblock) throw new AppError('FORBIDDEN', 'Lead deletion permission is required to clear a contact restriction.', 403)
    const blocked = input.action === 'block'
    const row = await db.contactSuppression.upsert({ where: { organizationId_email: { organizationId, email: input.email } }, create: { organizationId, email: input.email, blocked, reason: input.reason, updatedById: userId }, update: { blocked, reason: input.reason, updatedById: userId, revision: { increment: 1 } } })
    if (blocked) {
      const targets = await db.$queryRaw<Array<{ id: string }>>`SELECT DISTINCT COALESCE("mergedIntoId",id) AS id FROM "Lead" WHERE "organizationId"=${organizationId} AND (lower(btrim(email))=${input.email} OR lower(btrim("altEmail"))=${input.email})`
      await db.cadenceEnrollment.updateMany({ where: { organizationId, leadId: { in: targets.map(row => row.id) }, status: { in: ['ACTIVE', 'PAUSED'] } }, data: { status: 'EXITED', exitReason: 'do_not_contact', completedAt: new Date() } })
    }
    await db.auditEntry.create({ data: { organizationId, userId, action: 'UPDATE', entityType: 'ContactSuppression', entityId: row.id, changes: { email: input.email, blocked, reason: input.reason, revision: row.revision, reviewedFromLeadId: leadId } } })
    const final = await snapshot(db, organizationId, userId, leadId, true)
    if (final.stamp !== before.stamp) throw conflict()
    if (input.action === 'unblock' && !final.view.canUnblock) throw new AppError('FORBIDDEN', 'Current review permission is required.', 403)
    return final.view
  }, { timeout: 20000 }))
}
export async function stopBlockedCadence(organizationId: string, leadId: string, enrollmentId: string) {
  try { await assertContactAllowed(organizationId, leadId); return false } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'CONTACT_BLOCKED') throw error
    await exitContactEnrollment(organizationId, leadId, enrollmentId)
    return true
  }
}

export async function exitContactEnrollment(organizationId: string, leadId: string, enrollmentId: string) {
  await prisma.cadenceEnrollment.updateMany({ where: { id: enrollmentId, organizationId, leadId, status: { in: ['ACTIVE', 'PAUSED'] } }, data: { status: 'EXITED', exitReason: 'do_not_contact', completedAt: new Date() } })
}

/** Serializes local cadence effects with contact changes; never run network work here. */
export async function runContactCadenceEffect(organizationId: string, leadId: string, enrollmentId: string, run: (db: Prisma.TransactionClient) => Promise<unknown>) {
  try {
    return await withContactEnrollment(organizationId, async db => {
      const enrollment = await db.cadenceEnrollment.findFirst({ where: { id: enrollmentId, organizationId, leadId, status: 'ACTIVE' } })
      if (!enrollment || enrollment.status !== 'ACTIVE') return false
      await assertContactAllowed(organizationId, leadId, undefined, db)
      await run(db)
      await assertContactAllowed(organizationId, leadId, undefined, db)
      return true
    })
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'CONTACT_BLOCKED') throw error
    await exitContactEnrollment(organizationId, leadId, enrollmentId)
    return false
  }
}
