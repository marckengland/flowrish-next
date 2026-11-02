import 'server-only'
import { z, ZodError } from 'zod'
import { AppError } from '@/lib/errors'
import { faqDraftInputSchema, type FaqDraftResult, type FaqOrigin } from '@/lib/rehearsal-faq'
import { rehearsalSnapshotSchema } from '@/lib/receptionist-rehearsal'
import { prisma } from '@/server/db/client'
import { getEffectivePermissions } from '@/server/auth/permissions'

const idSchema = z.string().uuid()
interface LockedRehearsal { id: string; updatedAt: Date; snapshot: unknown; unansweredMessageIndexes: number[] }

async function withAdmin<T>(organizationId: string, userId: string, action: () => Promise<T>): Promise<T> {
  try {
    const member = await prisma.organizationMember.findUnique({ where: { userId_organizationId: { userId, organizationId } }, select: { id: true } })
    if (!member || !(await getEffectivePermissions(userId, organizationId)).has('admin:settings')) throw new AppError('FORBIDDEN', 'Administrator access to this organization is required.', 403)
    return await action()
  } catch (error) {
    if (error instanceof AppError || error instanceof ZodError) throw error
    throw new AppError('FAQ_DRAFT_UNAVAILABLE', 'Rehearsal FAQ drafts are unavailable. Please try again.', 503)
  }
}

export async function createRehearsalFaq(organizationId: string, userId: string, rehearsalId: string, raw: unknown): Promise<FaqDraftResult> {
  return withAdmin(organizationId, userId, async () => {
    idSchema.parse(rehearsalId)
    const input = faqDraftInputSchema.parse(raw)
    return prisma.$transaction(async tx => {
      // Use the same organization lock as ordinary library creation for the shared cap.
      await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id"=${organizationId} FOR UPDATE`
      const [rehearsal] = await tx.$queryRaw<LockedRehearsal[]>`SELECT "id", "updatedAt", "snapshot", "unansweredMessageIndexes" FROM "ReceptionistRehearsal" WHERE "id"=${rehearsalId} AND "organizationId"=${organizationId} FOR UPDATE`
      if (!rehearsal) throw new AppError('REHEARSAL_NOT_FOUND', 'Rehearsal report not found.', 404)
      if (rehearsal.updatedAt.getTime() !== new Date(input.expectedUpdatedAt).getTime()) throw new AppError('REHEARSAL_CONFLICT', 'This review changed. Reload the rehearsal before creating a FAQ draft.', 409)
      const snapshot = rehearsalSnapshotSchema.safeParse(rehearsal.snapshot)
      if (!snapshot.success) throw new AppError('FAQ_DRAFT_UNAVAILABLE', 'This rehearsal cannot be used to create a FAQ draft.', 503)
      const message = snapshot.data.messages[input.messageIndex]
      if (message?.role !== 'caller' || !rehearsal.unansweredMessageIndexes.includes(input.messageIndex)) throw new AppError('FAQ_QUESTION_NOT_FLAGGED', 'Save a caller question as needing knowledge before creating a FAQ draft.', 400)
      if (message.content.includes('\0')) throw new AppError('FAQ_QUESTION_INVALID', 'The saved question contains unsupported text.', 400)
      const existing = await tx.rehearsalFaqDraft.findFirst({ where: { organizationId, rehearsalId, messageIndex: input.messageIndex }, select: { documentId: true } })
      if (existing) return { documentId: existing.documentId, knowledgeUrl: `/knowledge?document=${existing.documentId}`, created: false }
      if (await tx.knowledgeDocument.count({ where: { organizationId, archivedAt: null } }) >= 50) throw new AppError('KNOWLEDGE_LIMIT', 'The library supports up to 50 active documents. Archive one before adding another.', 400)
      const document = await tx.knowledgeDocument.create({ data: { organizationId, createdById: userId, title: `FAQ: ${message.content.replace(/\s+/g, ' ')}`.slice(0, 160), category: 'FAQ', contentText: `Question: ${message.content}\n\nAnswer:\n` } })
      await tx.rehearsalFaqDraft.create({ data: { organizationId, rehearsalId, messageIndex: input.messageIndex, documentId: document.id } })
      await tx.auditEntry.create({ data: { organizationId, userId, action: 'CREATE', entityType: 'KnowledgeDocument', entityId: document.id, changes: { revision: document.revision } } })
      return { documentId: document.id, knowledgeUrl: `/knowledge?document=${document.id}`, created: true }
    })
  })
}

export async function getRehearsalFaqOrigin(organizationId: string, userId: string, documentId: string): Promise<FaqOrigin | null> {
  return withAdmin(organizationId, userId, async () => {
    idSchema.parse(documentId)
    const document = await prisma.knowledgeDocument.findFirst({ where: { id: documentId, organizationId }, select: { id: true } })
    if (!document) throw new AppError('NOT_FOUND', 'Knowledge document not found.', 404)
    const origin = await prisma.rehearsalFaqDraft.findFirst({ where: { organizationId, documentId }, select: { messageIndex: true, rehearsal: { select: { id: true, title: true } } } })
    return origin ? { rehearsalId: origin.rehearsal.id, title: origin.rehearsal.title, messageIndex: origin.messageIndex, rehearsalUrl: `/settings?section=receptionist&rehearsal=${origin.rehearsal.id}` } : null
  })
}
