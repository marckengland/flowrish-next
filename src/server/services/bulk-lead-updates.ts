import 'server-only'
import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'
import { prisma } from '@/server/db/client'
import { requirePermission } from '@/server/auth/permissions'
import { getLeadAccessFilter, type LeadAccessFilter } from './access'
import { AppError } from '@/lib/errors'
import { bulkLeadApplyInput, bulkLeadChange, bulkLeadOptionsSchema, bulkLeadPreview, bulkLeadPreviewInput, bulkLeadResult, bulkLeadSnapshots, type BulkLeadChange } from '@/lib/bulk-lead-updates'

type Db = Prisma.TransactionClient
const conflict = () => new AppError('BULK_LEADS_CHANGED', 'The selection, access or target changed. Refresh leads and prepare a new preview. Nothing was updated.', 409)
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const label = (user: { name: string; email: string }) => user.name.trim() ? `${user.name} (${user.email})` : user.email
async function safe<T>(action: () => Promise<T>) {
  try { return await action() }
  catch (error) {
    if (error instanceof AppError || error instanceof ZodError) throw error
    if (error && typeof error === 'object' && 'code' in error && ['P2002', 'P2034'].includes(String(error.code))) throw conflict()
    throw new AppError('BULK_LEADS_UNAVAILABLE', 'Bulk lead updates are unavailable. Refresh the result or retry the same confirmed request.', 503)
  }
}
async function access(db: Db, organizationId: string, userId: string) {
  const member = await db.organizationMember.findUnique({ where: { userId_organizationId: { userId, organizationId } }, select: { id: true } })
  const user = await db.user.findUnique({ where: { id: userId }, include: { organizationMemberships: true, teamMemberships: { where: { team: { organizationId } }, include: { team: true, role: { include: { permissions: true } } } } } })
  if (!member || !user || !user.organizationMemberships.some(value => value.organizationId === organizationId)) throw new AppError('FORBIDDEN', 'Current lead access to this business is required.', 403)
  requirePermission(user, 'leads:read'); requirePermission(user, 'leads:write')
  return getLeadAccessFilter(user, organizationId)
}
function ownerScope(filter: LeadAccessFilter) { return filter.assignedUserId === undefined ? {} : { userId: filter.assignedUserId } }
async function target(db: Db, organizationId: string, change: BulkLeadChange, filter: LeadAccessFilter, lock = false) {
  if (change.field === 'leadStatus') return { label: change.value, hash: null }
  const allowed = filter.assignedUserId
  if (allowed !== undefined && (typeof allowed === 'string' ? allowed !== change.value : !allowed.in.includes(change.value))) throw new AppError('FORBIDDEN', 'Choose an owner within your lead-access scope.', 403)
  if (lock) {
    const rows = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM "OrganizationMember" WHERE "organizationId"=${organizationId} AND "userId"=${change.value} FOR KEY SHARE`
    if (!rows.length) throw conflict()
    await db.$queryRaw`SELECT id FROM "User" WHERE id=${change.value} FOR SHARE`
  }
  const member = await db.organizationMember.findUnique({ where: { userId_organizationId: { userId: change.value, organizationId } }, include: { user: true } })
  if (!member) throw conflict()
  const displayed = label(member.user)
  return { label: displayed, hash: digest({ id: change.value, label: displayed }) }
}
const select = { id: true, firstName: true, lastName: true, updatedAt: true, assignedUserId: true, leadStatus: true, assignedUser: { select: { name: true, email: true } } } satisfies Prisma.LeadSelect
type Row = Prisma.LeadGetPayload<{ select: typeof select }>
function check(rows: Row[], selection: Array<{ id: string; expectedUpdatedAt: string }>) {
  if (rows.length !== selection.length || selection.some(item => !rows.some(row => row.id === item.id && row.updatedAt.toISOString() === item.expectedUpdatedAt))) throw conflict()
}
function applied(row: { id: string; appliedAt: Date | null; updatedCount: number | null; unchangedCount: number | null }) {
  return bulkLeadResult.parse({ state: 'applied', id: row.id, updated: row.updatedCount, unchanged: row.unchangedCount, appliedAt: row.appliedAt?.toISOString() })
}
function preview(row: { id: string; expiresAt: Date }, change: BulkLeadChange, destination: { label: string }, rows: Row[]) {
  return bulkLeadPreview.parse({ state: 'preview', id: row.id, expiresAt: row.expiresAt.toISOString(), change, targetLabel: destination.label, rows: rows.map(lead => ({ id: lead.id, label: `${lead.firstName} ${lead.lastName}`.trim(), before: change.field === 'leadStatus' ? lead.leadStatus : lead.assignedUser ? label(lead.assignedUser) : 'Unassigned', after: destination.label, changed: lead[change.field] !== change.value })) })
}
export async function bulkLeadOptions(organizationId: string, userId: string) {
  return safe(async () => {
    const filter = await access(prisma, organizationId, userId)
    const members = await prisma.organizationMember.findMany({ where: { organizationId, ...ownerScope(filter) }, select: { userId: true, user: { select: { id: true, name: true, email: true } } }, orderBy: [{ user: { name: 'asc' } }, { userId: 'asc' }], take: 201 })
    return bulkLeadOptionsSchema.parse({ owners: members.slice(0, 200).map(member => ({ id: member.userId, label: label(member.user) })), ownersTruncated: members.length > 200 })
  })
}
export async function previewBulkLeadUpdate(organizationId: string, userId: string, raw: unknown) {
  const input = bulkLeadPreviewInput.parse(raw), requestHash = digest(input)
  return safe(() => prisma.$transaction(async db => {
    const locked = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM "OrganizationMember" WHERE "organizationId"=${organizationId} AND "userId"=${userId} FOR UPDATE`
    if (!locked.length) throw new AppError('FORBIDDEN', 'Current membership is required.', 403)
    const filter = await access(db, organizationId, userId), now = new Date()
    const existing = await db.bulkLeadUpdate.findFirst({ where: { id: input.id, organizationId, userId } })
    if (existing && existing.requestHash !== requestHash) throw conflict()
    if (existing?.appliedAt) return applied(existing)
    if (existing && existing.expiresAt <= now) throw new AppError('BULK_PREVIEW_EXPIRED', 'This preview expired. Prepare a new preview.', 410)
    const destination = await target(db, organizationId, input.change, filter)
    const rows = await db.lead.findMany({ where: { organizationId, deletedAt: null, id: { in: input.leads.map(item => item.id) }, AND: [filter] }, select, orderBy: { id: 'asc' } })
    check(rows, input.leads)
    if (existing) {
      if (existing.targetHash !== destination.hash) throw conflict()
      return preview(existing, input.change, destination, rows)
    }
    await db.bulkLeadUpdate.deleteMany({ where: { organizationId, userId, OR: [{ appliedAt: null, expiresAt: { lt: now } }, { appliedAt: { lt: new Date(now.getTime() - 90 * 86400000) } }] } })
    if (await db.bulkLeadUpdate.count({ where: { organizationId, userId, appliedAt: null } }) >= 20) throw new AppError('BULK_PREVIEW_LIMIT', 'Too many pending previews. Wait for previews to expire before preparing another.', 429)
    const record = await db.bulkLeadUpdate.create({ data: { id: input.id, organizationId, userId, requestHash, change: input.change, snapshots: rows.map(lead => ({ id: lead.id, expectedUpdatedAt: lead.updatedAt.toISOString(), oldValue: lead[input.change.field] })), targetHash: destination.hash, expiresAt: new Date(now.getTime() + 600000) } })
    return preview(record, input.change, destination, rows)
  }, { timeout: 15000 }))
}
export async function applyBulkLeadUpdate(organizationId: string, userId: string, raw: unknown) {
  const { id } = bulkLeadApplyInput.parse(raw)
  return safe(() => prisma.$transaction(async db => {
    const membership = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM "OrganizationMember" WHERE "organizationId"=${organizationId} AND "userId"=${userId} FOR KEY SHARE`
    if (!membership.length) throw new AppError('FORBIDDEN', 'Current membership is required.', 403)
    await access(db, organizationId, userId)
    await db.$queryRaw`SELECT id FROM "BulkLeadUpdate" WHERE id=${id} AND "organizationId"=${organizationId} AND "userId"=${userId} FOR UPDATE`
    const record = await db.bulkLeadUpdate.findFirst({ where: { id, organizationId, userId } })
    if (!record) throw new AppError('BULK_PREVIEW_NOT_FOUND', 'Preview or result not found.', 404)
    if (record.appliedAt) return applied(record)
    if (record.expiresAt <= new Date()) throw new AppError('BULK_PREVIEW_EXPIRED', 'This preview expired. Prepare a new preview.', 410)
    const change = bulkLeadChange.parse(record.change), snapshots = bulkLeadSnapshots.parse(record.snapshots)
    const ids = snapshots.map(item => item.id).sort()
    await db.$queryRaw(Prisma.sql`SELECT id FROM "Lead" WHERE "organizationId"=${organizationId} AND id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`)
    // Row-lock waits must not preserve an earlier authorization or target snapshot.
    const beforeTargetLock = await access(db, organizationId, userId)
    await target(db, organizationId, change, beforeTargetLock, true)
    const filter = await access(db, organizationId, userId)
    const destination = await target(db, organizationId, change, filter)
    if (record.targetHash !== destination.hash) throw conflict()
    if (record.expiresAt <= new Date()) throw new AppError('BULK_PREVIEW_EXPIRED', 'This preview expired. Prepare a new preview.', 410)
    const rows = await db.lead.findMany({ where: { organizationId, deletedAt: null, id: { in: ids }, AND: [filter] }, select, orderBy: { id: 'asc' } })
    check(rows, snapshots)
    if (rows.some(lead => snapshots.find(item => item.id === lead.id)?.oldValue !== lead[change.field])) throw conflict()
    const changed = rows.filter(lead => lead[change.field] !== change.value)
    const stamp = new Date(Math.max(Date.now(), ...rows.map(lead => lead.updatedAt.getTime() + 1)))
    if (changed.length) {
      const result = await db.lead.updateMany({ where: { organizationId, deletedAt: null, AND: [filter, { OR: changed.map(lead => ({ id: lead.id, updatedAt: lead.updatedAt })) }] }, data: { [change.field]: change.value, updatedAt: stamp } })
      if (result.count !== changed.length) throw conflict()
      const audit = await db.auditEntry.createMany({ data: changed.map(lead => ({ organizationId, userId, action: 'UPDATE' as const, entityType: 'Lead', entityId: lead.id, changes: { [change.field]: { old: lead[change.field], new: change.value }, bulkRequestId: id, appliedUpdatedAt: stamp.toISOString() } })) })
      if (audit.count !== changed.length) throw new Error('Incomplete bulk audit')
    }
    const receipt = await db.bulkLeadUpdate.update({ where: { id }, data: { appliedAt: stamp, updatedCount: changed.length, unchangedCount: rows.length - changed.length, snapshots: [] } })
    return applied(receipt)
  }, { timeout: 15000 }))
}
