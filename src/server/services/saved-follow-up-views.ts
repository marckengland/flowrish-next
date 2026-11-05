import 'server-only'
import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'
import { prisma } from '@/server/db/client'
import { getEffectivePermissions } from '@/server/auth/permissions'
import { AppError } from '@/lib/errors'
import { SAVED_FOLLOW_UP_VIEW_LIMIT, savedFollowUpSettingsSchema, savedFollowUpViewCreateSchema, savedFollowUpViewDeleteSchema, savedFollowUpViewIdSchema, savedFollowUpViewSchema, savedFollowUpViewUpdateSchema } from '@/lib/saved-follow-up-views'

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
function wire(row: { id: string; name: string; settings: Prisma.JsonValue; revision: number; updatedAt: Date }) {
  return savedFollowUpViewSchema.parse({ id: row.id, name: row.name, settings: row.settings, revision: row.revision, updatedAt: row.updatedAt.toISOString() })
}
async function write<T>(organizationId: string, userId: string, action: (db: Prisma.TransactionClient) => Promise<T>) {
  return safe(() => prisma.$transaction(async db => {
    const members = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM "OrganizationMember" WHERE "organizationId"=${organizationId} AND "userId"=${userId} FOR UPDATE`
    if (!members.length) throw new AppError('FORBIDDEN', 'Current membership is required.', 403)
    await access(organizationId, userId)
    return action(db)
  }))
}
export async function listSavedFollowUpViews(organizationId: string, userId: string) {
  return safe(async () => {
    await access(organizationId, userId)
    const rows = await prisma.savedFollowUpView.findMany({ where: { organizationId, userId }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: SAVED_FOLLOW_UP_VIEW_LIMIT })
    return rows.map(wire)
  })
}
export async function createSavedFollowUpView(organizationId: string, userId: string, raw: unknown) {
  const input = savedFollowUpViewCreateSchema.parse(raw)
  return write(organizationId, userId, async db => {
    const scope = { id: input.id, organizationId, userId }
    const existing = await db.savedFollowUpView.findFirst({ where: scope })
    if (existing) {
      if (existing.name !== input.name || JSON.stringify(savedFollowUpSettingsSchema.parse(existing.settings)) !== JSON.stringify(input.settings)) throw conflict()
      return wire(existing)
    }
    if (await db.savedFollowUpView.count({ where: { organizationId, userId } }) >= SAVED_FOLLOW_UP_VIEW_LIMIT) throw new AppError('SAVED_VIEW_LIMIT', 'You can save up to 20 views per business. Delete a view before adding another.', 409)
    return wire(await db.savedFollowUpView.create({ data: { ...input, organizationId, userId } }))
  })
}
export async function updateSavedFollowUpView(organizationId: string, userId: string, id: string, raw: unknown) {
  savedFollowUpViewIdSchema.parse(id)
  const { expectedRevision, ...changes } = savedFollowUpViewUpdateSchema.parse(raw)
  return write(organizationId, userId, async db => {
    const scope = { id, organizationId, userId }
    if (!await db.savedFollowUpView.findFirst({ where: scope })) throw missing()
    const result = await db.savedFollowUpView.updateMany({ where: { ...scope, revision: expectedRevision }, data: { ...changes, revision: { increment: 1 } } })
    if (!result.count) throw conflict()
    const row = await db.savedFollowUpView.findFirst({ where: scope })
    if (!row) throw missing()
    return wire(row)
  })
}
export async function deleteSavedFollowUpView(organizationId: string, userId: string, id: string, raw: unknown) {
  savedFollowUpViewIdSchema.parse(id)
  const { expectedRevision } = savedFollowUpViewDeleteSchema.parse(raw)
  return write(organizationId, userId, async db => {
    const scope = { id, organizationId, userId }
    if (!await db.savedFollowUpView.findFirst({ where: scope })) throw missing()
    const result = await db.savedFollowUpView.deleteMany({ where: { ...scope, revision: expectedRevision } })
    if (!result.count) throw conflict()
    return { deleted: true }
  })
}
