import 'server-only'
import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'
import { AppError } from '@/lib/errors'
import { gapKeySchema, gapPageSchema, gapListQuerySchema, gapReviewInputSchema, gapFaqInputSchema, gapGroupSchema, gapOccurrenceSchema, type KnowledgeGapGroup, type KnowledgeGapDetail, type KnowledgeGapList } from '@/lib/knowledge-gaps'
import { prisma } from '@/server/db/client'
import { getEffectivePermissions } from '@/server/auth/permissions'
import { createRehearsalFaqInTransaction } from './rehearsal-faq'
import { knowledgeGapCte } from './knowledge-gaps-sql'

interface GroupRow {
  key: string; version: string; question: string; occurrenceCount: number; latestAt: Date; status: string; changedSinceResolution: boolean;
  draft: number; published: number; approved: number; archived: number; sourceFingerprint: string; reviewNotes: string | null; resolvedAt: Date | null; reviewUpdatedAt: Date | null
}
interface OccurrenceRow { rehearsalId: string; title: string; messageIndex: number; updatedAt: Date; documentId: string | null; documentTitle: string | null; faqStatus: string | null }
type Reader = Pick<Prisma.TransactionClient, '$queryRaw'>
const pageSize = 20
const missing = () => new AppError('KNOWLEDGE_GAP_NOT_FOUND', 'Knowledge gap not found.', 404)
const conflict = () => new AppError('KNOWLEDGE_GAP_CONFLICT', 'This question changed. Reload the latest saved question before continuing.', 409)

async function withAdmin<T>(organizationId: string, userId: string, action: () => Promise<T>): Promise<T> {
  try {
    const member = await prisma.organizationMember.findUnique({ where: { userId_organizationId: { userId, organizationId } }, select: { id: true } })
    if (!member || !(await getEffectivePermissions(userId, organizationId)).has('admin:settings')) throw new AppError('FORBIDDEN', 'Administrator access to this organization is required.', 403)
    return await action()
  } catch (error) {
    if (error instanceof AppError || error instanceof ZodError) throw error
    throw new AppError('KNOWLEDGE_GAPS_UNAVAILABLE', 'Knowledge gaps are unavailable. Please try again.', 503)
  }
}
function group(row: GroupRow): KnowledgeGapGroup {
  return gapGroupSchema.parse({ key: row.key, version: row.version, question: row.question, occurrenceCount: row.occurrenceCount, latestAt: row.latestAt.toISOString(), status: row.status, changedSinceResolution: row.changedSinceResolution, faqCounts: { draft: row.draft, published: row.published, approved: row.approved, archived: row.archived }, resolution: row.reviewNotes === null ? null : { notes: row.reviewNotes, resolvedAt: row.resolvedAt?.toISOString() ?? null } })
}
async function currentGroup(reader: Reader, organizationId: string, key: string): Promise<GroupRow> {
  const [row] = await reader.$queryRaw<GroupRow[]>`${knowledgeGapCte(organizationId)} SELECT * FROM inbox WHERE key=${key}`
  if (!row) throw missing()
  return row
}
async function detail(reader: Reader, organizationId: string, key: string, page: number): Promise<KnowledgeGapDetail> {
  const current = await currentGroup(reader, organizationId, key)
  const rows = await reader.$queryRaw<OccurrenceRow[]>`${knowledgeGapCte(organizationId)} SELECT * FROM occurrences WHERE key=${key} ORDER BY "createdAt" ASC, "rehearsalId" ASC, "messageIndex" ASC LIMIT ${pageSize + 1} OFFSET ${(page - 1) * pageSize}`
  return { group: group(current), occurrences: rows.slice(0, pageSize).map(row => gapOccurrenceSchema.parse({ rehearsalId: row.rehearsalId, title: row.title, messageIndex: row.messageIndex, updatedAt: row.updatedAt.toISOString(), rehearsalUrl: `/settings?section=receptionist&rehearsal=${row.rehearsalId}`, faq: row.documentId ? { documentId: row.documentId, title: row.documentTitle, status: row.faqStatus, knowledgeUrl: `/knowledge?document=${row.documentId}` } : null })), page, pageSize, hasMore: rows.length > pageSize }
}
async function lockSources(tx: Prisma.TransactionClient, organizationId: string, key: string) {
  await tx.$queryRaw`${knowledgeGapCte(organizationId)} SELECT r."id" FROM "ReceptionistRehearsal" r JOIN (SELECT DISTINCT "rehearsalId" FROM occurrences WHERE key=${key}) q ON q."rehearsalId"=r."id" WHERE r."organizationId"=${organizationId} ORDER BY r."id" FOR UPDATE OF r`
  await tx.$queryRaw`${knowledgeGapCte(organizationId)} SELECT d."id" FROM "KnowledgeDocument" d JOIN (SELECT DISTINCT "documentId" FROM occurrences WHERE key=${key} AND "documentId" IS NOT NULL) q ON q."documentId"=d."id" WHERE d."organizationId"=${organizationId} ORDER BY d."id" FOR SHARE OF d`
}

export async function getKnowledgeGapList(organizationId: string, userId: string, raw: unknown): Promise<KnowledgeGapList> {
  return withAdmin(organizationId, userId, async () => {
    const query = gapListQuerySchema.parse(raw)
    const status = query.status === 'all' ? Prisma.empty : Prisma.sql`WHERE status=${query.status}`
    const rows = await prisma.$queryRaw<GroupRow[]>`${knowledgeGapCte(organizationId)} SELECT * FROM inbox ${status} ORDER BY "latestAt" DESC, key ASC LIMIT ${pageSize + 1} OFFSET ${(query.page - 1) * pageSize}`
    return { groups: rows.slice(0, pageSize).map(group), page: query.page, pageSize, hasMore: rows.length > pageSize }
  })
}
export async function getKnowledgeGapDetail(organizationId: string, userId: string, key: string, raw: unknown): Promise<KnowledgeGapDetail> {
  return withAdmin(organizationId, userId, async () => {
    gapKeySchema.parse(key)
    const { page } = gapPageSchema.parse(raw)
    return prisma.$transaction(tx => detail(tx, organizationId, key, page), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
  })
}
export async function reviewKnowledgeGap(organizationId: string, userId: string, key: string, raw: unknown): Promise<KnowledgeGapDetail> {
  return withAdmin(organizationId, userId, async () => {
    gapKeySchema.parse(key)
    const input = gapReviewInputSchema.parse(raw)
    return prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id"=${organizationId} FOR NO KEY UPDATE`
      await lockSources(tx, organizationId, key)
      const current = await currentGroup(tx, organizationId, key)
      if (current.version !== input.expectedVersion) throw conflict()
      const now = new Date(Math.max(Date.now(), (current.reviewUpdatedAt?.getTime() ?? 0) + 1))
      const data = { resolvedFingerprint: input.action === 'resolve' ? current.sourceFingerprint : null, resolvedAt: input.action === 'resolve' ? now : null, resolvedById: input.action === 'resolve' ? userId : null, notes: input.notes, updatedAt: now }
      await tx.knowledgeGapReview.upsert({ where: { organizationId_questionKey: { organizationId, questionKey: key } }, create: { organizationId, questionKey: key, ...data }, update: data })
      return detail(tx, organizationId, key, 1)
    })
  })
}
export async function createKnowledgeGapFaq(organizationId: string, userId: string, key: string, raw: unknown) {
  return withAdmin(organizationId, userId, async () => {
    gapKeySchema.parse(key)
    const input = gapFaqInputSchema.parse(raw)
    return prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id"=${organizationId} FOR NO KEY UPDATE`
      await lockSources(tx, organizationId, key)
      const current = await currentGroup(tx, organizationId, key)
      const [existing] = await tx.$queryRaw<OccurrenceRow[]>`${knowledgeGapCte(organizationId)} SELECT * FROM occurrences WHERE key=${key} AND "documentId" IS NOT NULL ORDER BY ("faqStatus"='archived') ASC, "createdAt" ASC, "rehearsalId" ASC, "messageIndex" ASC LIMIT 1`
      if (existing?.documentId) return { documentId: existing.documentId, knowledgeUrl: `/knowledge?document=${existing.documentId}`, created: false }
      if (current.version !== input.expectedVersion) throw conflict()
      const [source] = await tx.$queryRaw<OccurrenceRow[]>`${knowledgeGapCte(organizationId)} SELECT * FROM occurrences WHERE key=${key} ORDER BY "createdAt" ASC, "rehearsalId" ASC, "messageIndex" ASC LIMIT 1`
      if (!source) throw missing()
      return createRehearsalFaqInTransaction(tx, organizationId, userId, source.rehearsalId, { messageIndex: source.messageIndex, expectedUpdatedAt: source.updatedAt.toISOString() })
    })
  })
}
