import 'server-only'
import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'
import { prisma } from '@/server/db/client'
import { getEffectivePermissions } from '@/server/auth/permissions'
import { AppError } from '@/lib/errors'
import { SAVED_LEAD_VIEW_LIMIT, savedLeadFiltersSchema, savedLeadViewCreateSchema, savedLeadViewDeleteSchema, savedLeadViewIdSchema, savedLeadViewSchema, savedLeadViewUpdateSchema, type SavedLeadFilters } from '@/lib/saved-lead-views'

const missing = () => new AppError('SAVED_VIEW_NOT_FOUND', 'Saved view not found.', 404)
const conflict = () => new AppError('SAVED_VIEW_CONFLICT', 'This saved view changed. Refresh saved views and select it again.', 409)
async function safe<T>(action: () => Promise<T>) {
  try { return await action() }
  catch (error) {
    if (error instanceof AppError || error instanceof ZodError) throw error
    if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') throw new AppError('SAVED_VIEW_DUPLICATE', 'A saved view already uses that name or identifier. Refresh and choose another name.', 409)
    throw new AppError('SAVED_VIEWS_UNAVAILABLE', 'Saved views are unavailable. Please refresh and try again.', 503)
  }
}
async function access(organizationId: string, userId: string) {
  const member = await prisma.organizationMember.findUnique({ where: { userId_organizationId: { userId, organizationId } }, select: { id: true } })
  if (!member || !(await getEffectivePermissions(userId, organizationId)).has('leads:read')) throw new AppError('FORBIDDEN', 'Current lead-read access to this business is required.', 403)
}
function wire(row: { id: string; name: string; filters: Prisma.JsonValue; revision: number; updatedAt: Date }) {
  return savedLeadViewSchema.parse({ id: row.id, name: row.name, filters: row.filters, revision: row.revision, updatedAt: row.updatedAt.toISOString() })
}
async function references(db: Prisma.TransactionClient, organizationId: string, filters: SavedLeadFilters) {
  if (filters.stageId && !await db.stage.findFirst({ where: { id: filters.stageId, pipeline: { organizationId }, ...(filters.pipelineId ? { pipelineId: filters.pipelineId } : {}) }, select: { id: true } })) throw new AppError('INVALID_VIEW_FILTER', 'Choose an available stage in this business.', 400)
  if (filters.pipelineId && !await db.pipeline.findFirst({ where: { id: filters.pipelineId, organizationId }, select: { id: true } })) throw new AppError('INVALID_VIEW_FILTER', 'Choose an available pipeline in this business.', 400)
  if (filters.assignedUserId && !await db.organizationMember.findUnique({ where: { userId_organizationId: { userId: filters.assignedUserId, organizationId } }, select: { id: true } })) throw new AppError('INVALID_VIEW_FILTER', 'Choose a current member of this business.', 400)
}
async function write<T>(organizationId: string, userId: string, action: (db: Prisma.TransactionClient) => Promise<T>) {
  return safe(() => prisma.$transaction(async db => {
    const members = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM "OrganizationMember" WHERE "organizationId"=${organizationId} AND "userId"=${userId} FOR UPDATE`
    if (!members.length) throw new AppError('FORBIDDEN', 'Current membership is required.', 403)
    await access(organizationId, userId)
    return action(db)
  }))
}
export async function listSavedLeadViews(organizationId: string, userId: string) {
  return safe(async () => {
    await access(organizationId, userId)
    const rows = await prisma.savedLeadView.findMany({ where: { organizationId, userId }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: SAVED_LEAD_VIEW_LIMIT })
    return rows.map(wire)
  })
}
export async function createSavedLeadView(organizationId: string, userId: string, raw: unknown) {
  const input = savedLeadViewCreateSchema.parse(raw)
  return write(organizationId, userId, async db => {
    const scope = { id: input.id, organizationId, userId }
    const existing = await db.savedLeadView.findFirst({ where: scope })
    if (existing) {
      if (existing.name !== input.name || JSON.stringify(savedLeadFiltersSchema.parse(existing.filters)) !== JSON.stringify(input.filters)) throw conflict()
      return wire(existing)
    }
    if (await db.savedLeadView.count({ where: { organizationId, userId } }) >= SAVED_LEAD_VIEW_LIMIT) throw new AppError('SAVED_VIEW_LIMIT', 'You can save up to 20 views per business. Delete a view before adding another.', 409)
    await references(db, organizationId, input.filters)
    return wire(await db.savedLeadView.create({ data: { ...input, organizationId, userId } }))
  })
}
export async function updateSavedLeadView(organizationId: string, userId: string, id: string, raw: unknown) {
  savedLeadViewIdSchema.parse(id)
  const { expectedRevision, ...changes } = savedLeadViewUpdateSchema.parse(raw)
  return write(organizationId, userId, async db => {
    const scope = { id, organizationId, userId }
    if (!await db.savedLeadView.findFirst({ where: scope })) throw missing()
    if (changes.filters) await references(db, organizationId, changes.filters)
    const result = await db.savedLeadView.updateMany({ where: { ...scope, revision: expectedRevision }, data: { ...changes, revision: { increment: 1 } } })
    if (!result.count) throw conflict()
    const row = await db.savedLeadView.findFirst({ where: scope })
    if (!row) throw missing()
    return wire(row)
  })
}
export async function deleteSavedLeadView(organizationId: string, userId: string, id: string, raw: unknown) {
  savedLeadViewIdSchema.parse(id)
  const { expectedRevision } = savedLeadViewDeleteSchema.parse(raw)
  return write(organizationId, userId, async db => {
    const scope = { id, organizationId, userId }
    if (!await db.savedLeadView.findFirst({ where: scope })) throw missing()
    const result = await db.savedLeadView.deleteMany({ where: { ...scope, revision: expectedRevision } })
    if (!result.count) throw conflict()
    return { deleted: true }
  })
}
