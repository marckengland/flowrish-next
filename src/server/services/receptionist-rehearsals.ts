import 'server-only'
import { z, ZodError } from 'zod'
import type { ReceptionistRehearsal } from '@prisma/client'
import { AppError } from '@/lib/errors'
import { rehearsalSnapshotSchema, rehearsalReviewSchema, validateRehearsalReview, type RehearsalReport, type RehearsalSummary } from '@/lib/receptionist-rehearsal'
import { prisma } from '@/server/db/client'
import { getEffectivePermissions } from '@/server/auth/permissions'

const idSchema = z.string().uuid()
const createSchema = z.object({ title: z.string().trim().min(1).max(120), snapshot: rehearsalSnapshotSchema }).strict()
const reviewSchema = z.object({ expectedUpdatedAt: z.string().datetime(), verdict: z.enum(['unreviewed', 'passed', 'needs_work']), notes: z.string().trim().max(2000), unansweredMessageIndexes: z.array(z.number().int().min(0).max(28)).max(14) }).strict()
const missing = () => new AppError('REHEARSAL_NOT_FOUND', 'Rehearsal report not found.', 404)

async function withAdmin<T>(organizationId: string, userId: string, action: () => Promise<T>): Promise<T> {
  try {
    const member = await prisma.organizationMember.findUnique({ where: { userId_organizationId: { userId, organizationId } }, select: { id: true } })
    if (!member || !(await getEffectivePermissions(userId, organizationId)).has('admin:settings')) throw new AppError('FORBIDDEN', 'Administrator access to this organization is required.', 403)
    return await action()
  } catch (error) {
    if (error instanceof AppError || error instanceof ZodError) throw error
    throw new AppError('REHEARSAL_UNAVAILABLE', 'Rehearsal reports are unavailable. Please try again.', 503)
  }
}

function summary(row: Pick<ReceptionistRehearsal, 'id' | 'title' | 'verdict' | 'notes' | 'unansweredMessageIndexes' | 'createdAt' | 'updatedAt'>): RehearsalSummary {
  return { id: row.id, title: row.title, ...rehearsalReviewSchema.parse({ verdict: row.verdict, notes: row.notes, unansweredMessageIndexes: row.unansweredMessageIndexes }), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }
}
function report(row: ReceptionistRehearsal): RehearsalReport {
  return { ...summary(row), snapshot: rehearsalSnapshotSchema.parse(row.snapshot) }
}

export async function listRehearsals(organizationId: string, userId: string) {
  return withAdmin(organizationId, userId, async () => {
    const rows = await prisma.receptionistRehearsal.findMany({ where: { organizationId }, take: 25, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true, title: true, verdict: true, notes: true, unansweredMessageIndexes: true, createdAt: true, updatedAt: true } })
    return rows.map(summary)
  })
}
export async function createRehearsal(organizationId: string, userId: string, raw: unknown) {
  return withAdmin(organizationId, userId, async () => {
    const { title, snapshot } = createSchema.parse(raw)
    await prisma.receptionistRehearsal.createMany({ data: [{ organizationId, clientId: snapshot.clientId, createdById: userId, title, snapshot }], skipDuplicates: true })
    const row = await prisma.receptionistRehearsal.findFirst({ where: { organizationId, clientId: snapshot.clientId } })
    if (!row) throw missing()
    return report(row)
  })
}
export async function getRehearsal(organizationId: string, userId: string, id: string) {
  return withAdmin(organizationId, userId, async () => {
    const row = await prisma.receptionistRehearsal.findFirst({ where: { id: idSchema.parse(id), organizationId } })
    if (!row) throw missing()
    return report(row)
  })
}
export async function reviewRehearsal(organizationId: string, userId: string, id: string, raw: unknown) {
  return withAdmin(organizationId, userId, async () => {
    idSchema.parse(id)
    const { expectedUpdatedAt, ...input } = reviewSchema.parse(raw)
    const row = await prisma.receptionistRehearsal.findFirst({ where: { id, organizationId } })
    if (!row) throw missing()
    const snapshot = rehearsalSnapshotSchema.parse(row.snapshot)
    const review = validateRehearsalReview(input, snapshot.messages)
    const result = await prisma.receptionistRehearsal.updateMany({ where: { id, organizationId, updatedAt: new Date(expectedUpdatedAt) }, data: { ...review, updatedAt: new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1)) } })
    if (!result.count) throw new AppError('REHEARSAL_CONFLICT', 'This review changed. Reload the rehearsal before reviewing again.', 409)
    const updated = await prisma.receptionistRehearsal.findFirst({ where: { id, organizationId } })
    if (!updated) throw missing()
    return report(updated)
  })
}
export async function deleteRehearsal(organizationId: string, userId: string, id: string) {
  return withAdmin(organizationId, userId, async () => {
    const result = await prisma.receptionistRehearsal.deleteMany({ where: { id: idSchema.parse(id), organizationId } })
    if (!result.count) throw missing()
    return { deleted: true }
  })
}
