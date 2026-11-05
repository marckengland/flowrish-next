import 'server-only'
import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'
import { prisma } from '@/server/db/client'
import { AppError } from '@/lib/errors'
import { requirePermission } from '@/server/auth/permissions'
import { getLeadAccessFilter } from './access'
import { MERGE_RELATED_LIMIT, mergeApplyInput, mergePreview, mergePreviewInput, mergeResult } from '@/lib/lead-merge'
import { blockedTables, countsForMerge, mergeConflict, mergeDigest, mergeLeadHashes, mergeRelated, missingMergeContacts, movedTables } from './lead-merge-snapshot'
import { transferMergeRecords } from './lead-merge-transfer'

async function safe<T>(action: () => Promise<T>) {
  try { return await action() } catch (error) {
    if (error instanceof AppError || error instanceof ZodError) throw error
    if (error && typeof error === 'object' && 'code' in error && ['P2002', 'P2034'].includes(String(error.code))) throw mergeConflict()
    throw new AppError('MERGE_UNAVAILABLE', 'Could not confirm the merge. Retry the same confirmed request before starting another.', 503)
  }
}
export async function leadMergeAccess(db: Prisma.TransactionClient, organizationId: string, userId: string, merge = true) {
  const member = await db.organizationMember.findUnique({ where: { userId_organizationId: { userId, organizationId } }, select: { id: true } })
  const user = await db.user.findUnique({ where: { id: userId }, include: { organizationMemberships: true, teamMemberships: { where: { team: { organizationId } }, include: { team: true, role: { include: { permissions: true } } } } } })
  if (!member || !user || !user.organizationMemberships.some(value => value.organizationId === organizationId)) throw new AppError('FORBIDDEN', 'Current business membership is required.', 403)
  requirePermission(user, 'leads:read')
  if (merge) { requirePermission(user, 'leads:write'); requirePermission(user, 'leads:delete') }
  return getLeadAccessFilter(user, organizationId)
}
const include = { assignedUser: { select: { name: true, email: true } }, stage: { select: { name: true } }, company: { select: { name: true } } } satisfies Prisma.LeadInclude
function completed(record: { manifest: Prisma.JsonValue; result: Prisma.JsonValue | null }) {
  if (record.manifest && typeof record.manifest === 'object' && !Array.isArray(record.manifest) && 'undoneAt' in record.manifest) throw new AppError('MERGE_UNDONE', 'This merge was undone by an administrator. Reload and inspect both records before continuing.', 409)
  return mergeResult.parse(record.result)
}
type Lead = Prisma.LeadGetPayload<{ include: typeof include }>
async function snapshot(db: Prisma.TransactionClient, organizationId: string, userId: string, primaryId: string, secondaryId: string, lock = false) {
  const filter = await leadMergeAccess(db, organizationId, userId)
  const rows = await db.lead.findMany({ where: { organizationId, deletedAt: null, mergedIntoId: null, id: { in: [primaryId, secondaryId] }, AND: [filter] }, include, orderBy: { id: 'asc' } })
  const primary = rows.find(row => row.id === primaryId), secondary = rows.find(row => row.id === secondaryId)
  if (!primary || !secondary) throw new AppError('MERGE_NOT_FOUND', 'Both active leads must be accessible in this business.', 404)
  const related = await mergeRelated(db, organizationId, [primaryId, secondaryId], lock)
  const aliases = await db.lead.count({ where: { organizationId, mergedIntoId: secondaryId } })
  const workflowLabels = { CadenceEnrollment: 'cadence enrollment', FollowUpSuggestion: 'follow-up suggestion', ReceptionistCall: 'receptionist call', WaitlistCrmHandoff: 'waitlist handoff', CallbackCrmHandoff: 'callback handoff' }
  const blockers = blockedTables.filter(table => related[table].some(row => row.leadId === secondaryId)).map(table => `Secondary lead has ${workflowLabels[table]} links that need a separate workflow migration.`)
  if (aliases) blockers.push('Secondary lead has earlier merged records. Keep that lead instead, or request an administrator review.')
  if (Object.values(related).reduce((sum, rows) => sum + rows.length, 0) + missingMergeContacts(related, primaryId, secondaryId).length > MERGE_RELATED_LIMIT) throw new AppError('MERGE_TOO_LARGE', 'This merge has too much linked work for a safe review.', 413)
  return { primary, secondary, related, blockers, fingerprint: mergeDigest({ rows, related, aliases }) }
}
const fieldNames = ['firstName', 'lastName', 'email', 'altEmail', 'phone', 'title', 'description', 'companyName', 'companyIndustry', 'companyWebsite', 'companyLinkedinUrl', 'country', 'state', 'linkedinUrl', 'dealValue', 'currency', 'score', 'isClosed', 'closeDate', 'leadStatus', 'tier', 'stageId', 'assignedUserId', 'companyId', 'lastActivityAt', 'createdAt'] as const
function displayed(lead: Lead, key: typeof fieldNames[number]) {
  const value = lead[key]
  const text = value instanceof Date ? value.toISOString() : value === null || value === undefined ? '—' : String(value)
  return key === 'assignedUserId' && lead.assignedUser ? `${lead.assignedUser.name} (${lead.assignedUser.email}) · ${text}` : key === 'stageId' && lead.stage ? `${lead.stage.name} · ${text}` : key === 'companyId' && lead.company ? `${lead.company.name} · ${text}` : text
}
function wire(record: { id: string; expiresAt: Date }, value: Awaited<ReturnType<typeof snapshot>>) {
  return mergePreview.parse({ state: 'preview', id: record.id, primaryId: value.primary.id, secondaryId: value.secondary.id, primaryLabel: `${value.primary.firstName} ${value.primary.lastName}`.trim(), secondaryLabel: `${value.secondary.firstName} ${value.secondary.lastName}`.trim(), expiresAt: record.expiresAt.toISOString(), fields: fieldNames.map(key => ({ key, label: key.replace(/([A-Z])/g, ' $1'), primary: displayed(value.primary, key), secondary: displayed(value.secondary, key), different: displayed(value.primary, key) !== displayed(value.secondary, key) })), counts: countsForMerge(value.related, value.primary.id, value.secondary.id), blockers: value.blockers })
}
export async function previewLeadMerge(organizationId: string, userId: string, raw: unknown) {
  if (raw && typeof raw === 'object' && 'primaryId' in raw && 'secondaryId' in raw && raw.primaryId === raw.secondaryId) throw new AppError('SELF_MERGE', 'Choose two different leads.', 400)
  const input = mergePreviewInput.parse(raw)
  return safe(() => prisma.$transaction(async db => {
    const membership = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM "OrganizationMember" WHERE "organizationId"=${organizationId} AND "userId"=${userId} FOR UPDATE`
    if (!membership.length) throw new AppError('FORBIDDEN', 'Current membership is required.', 403)
    await leadMergeAccess(db, organizationId, userId)
    const existing = await db.leadMergeReview.findFirst({ where: { id: input.id, organizationId, userId } }), now = new Date()
    if (existing && (existing.primaryId !== input.primaryId || existing.secondaryId !== input.secondaryId)) throw mergeConflict()
    if (existing?.appliedAt) return completed(existing)
    if (existing && existing.expiresAt <= now) throw new AppError('MERGE_EXPIRED', 'This review expired. Prepare a new review.', 410)
    const value = await snapshot(db, organizationId, userId, input.primaryId, input.secondaryId)
    if (existing) { if (existing.fingerprint !== value.fingerprint) throw mergeConflict(); return wire(existing, value) }
    await db.leadMergeReview.deleteMany({ where: { organizationId, userId, appliedAt: null, expiresAt: { lt: now } } })
    if (await db.leadMergeReview.count({ where: { organizationId, userId, appliedAt: null } }) >= 20) throw new AppError('MERGE_REVIEW_LIMIT', 'Too many pending merge reviews. Wait for them to expire.', 429)
    const record = await db.leadMergeReview.create({ data: { ...input, organizationId, userId, fingerprint: value.fingerprint, expiresAt: new Date(now.getTime() + 600000) } })
    return wire(record, value)
  }, { timeout: 20000 }))
}
export async function applyLeadMerge(organizationId: string, userId: string, raw: unknown) {
  const { id } = mergeApplyInput.parse(raw)
  return safe(() => prisma.$transaction(async db => {
    const membership = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM "OrganizationMember" WHERE "organizationId"=${organizationId} AND "userId"=${userId} FOR KEY SHARE`
    if (!membership.length) throw new AppError('FORBIDDEN', 'Current membership is required.', 403)
    await leadMergeAccess(db, organizationId, userId)
    await db.$queryRaw`SELECT id FROM "LeadMergeReview" WHERE id=${id} AND "organizationId"=${organizationId} AND "userId"=${userId} FOR UPDATE`
    const record = await db.leadMergeReview.findFirst({ where: { id, organizationId, userId } })
    if (!record) throw new AppError('MERGE_NOT_FOUND', 'Review or result not found.', 404)
    if (record.appliedAt) return completed(record)
    if (record.expiresAt <= new Date()) throw new AppError('MERGE_EXPIRED', 'This review expired. Prepare a new review.', 410)
    const ids = [record.primaryId, record.secondaryId].sort()
    await db.$queryRaw(Prisma.sql`SELECT id FROM "Lead" WHERE "organizationId"=${organizationId} AND id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`)
    const value = await snapshot(db, organizationId, userId, record.primaryId, record.secondaryId, true)
    // Related-row waits can outlive the earlier permission snapshot.
    const filter = await leadMergeAccess(db, organizationId, userId)
    const accessible = await db.lead.findMany({ where: { organizationId, deletedAt: null, id: { in: ids }, AND: [filter] }, include, orderBy: { id: 'asc' } })
    if (accessible.length !== 2 || value.fingerprint !== record.fingerprint || value.blockers.length) throw mergeConflict()
    if (record.expiresAt <= new Date()) throw new AppError('MERGE_EXPIRED', 'This review expired. Prepare a new review.', 410)
    const stamp = new Date(Math.max(Date.now(), value.primary.updatedAt.getTime() + 1, value.secondary.updatedAt.getTime() + 1))
    const transferred = await transferMergeRecords(db, organizationId, record.primaryId, record.secondaryId, value.related, stamp)
    const primary = await db.lead.updateMany({ where: { organizationId, id: record.primaryId, deletedAt: null, mergedIntoId: null, updatedAt: value.primary.updatedAt, AND: [filter] }, data: { updatedAt: stamp } })
    const secondary = await db.lead.updateMany({ where: { organizationId, id: record.secondaryId, deletedAt: null, mergedIntoId: null, updatedAt: value.secondary.updatedAt, AND: [filter] }, data: { mergedIntoId: record.primaryId, deletedAt: stamp, updatedAt: stamp } })
    if (primary.count !== 1 || secondary.count !== 1) throw mergeConflict()
    const result = mergeResult.parse({ state: 'applied', id, primaryId: record.primaryId, secondaryId: record.secondaryId, counts: transferred.counts, appliedAt: stamp.toISOString() })
    const manifest = { moved: movedTables.flatMap(table => value.related[table].filter(row => row.leadId === record.secondaryId).map(row => ({ table, id: row.id }))), copiedContacts: transferred.copiedContacts, related: await mergeRelated(db, organizationId, ids), leads: await mergeLeadHashes(db, organizationId, ids) }
    const audit = await db.auditEntry.createMany({ data: ids.map(entityId => ({ organizationId, userId, entityType: 'Lead', entityId, action: 'UPDATE' as const, changes: { mergeReviewId: id, role: entityId === record.primaryId ? 'retained' : 'archived', primaryId: record.primaryId, secondaryId: record.secondaryId, counts: transferred.counts, appliedUpdatedAt: stamp.toISOString() } })) })
    if (audit.count !== 2) throw new Error('Incomplete merge audit')
    await db.leadMergeReview.update({ where: { id, organizationId, userId }, data: { appliedAt: stamp, result, manifest: manifest as unknown as Prisma.InputJsonValue } })
    return result
  }, { timeout: 20000 }))
}
