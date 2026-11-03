import 'server-only'
import { Prisma } from '@prisma/client'
import { z, ZodError } from 'zod'
import { AppError } from '@/lib/errors'
import { FEEDBACK_RETENTION_DAYS, feedbackActionSchema, feedbackFaqInputSchema, feedbackFaqSchema, feedbackListSchema, feedbackPolicyInputSchema, feedbackPolicySchema, feedbackQuerySchema } from '@/lib/visitor-feedback'
import { prisma } from '@/server/db/client'
import { callbackAccess } from './callback-access'

import { visitorFeedbackCutoff as cutoff } from '@/lib/visitor-feedback-retention'
export { cleanupVisitorFeedback } from './visitor-feedback-retention'
const idSchema = z.string().uuid()
type Db = Prisma.TransactionClient
async function run<T>(org: string, user: string, action: (db: Db) => Promise<T>): Promise<T> {
  try { return await prisma.$transaction(async db => { if (!(await callbackAccess(org, user, db)).admin) throw new AppError('FORBIDDEN', 'Organization administrator access is required.', 403); return action(db) }) }
  catch (error) { if (error instanceof AppError) throw error; if (error instanceof ZodError) throw new AppError('VALIDATION_ERROR', 'Check the feedback request and current version.', 400); throw new AppError('FEEDBACK_UNAVAILABLE', 'Visitor feedback is unavailable. Reload and try again.', 503) }
}
const conflict = () => { throw new AppError('FEEDBACK_CONFLICT', 'This feedback changed. Reload before trying again.', 409) }
async function row(db: Db, org: string, id: string) {
  idSchema.parse(id)
  const [record] = await db.$queryRaw<Prisma.WebsiteReceptionistFeedbackGetPayload<Record<string, never>>[]>`SELECT * FROM "WebsiteReceptionistFeedback" WHERE id=${id} AND "organizationId"=${org} AND "createdAt">${cutoff()} FOR UPDATE`
  if (!record) throw new AppError('NOT_FOUND', 'Visitor feedback not found.', 404)
  return record
}
export async function getVisitorFeedbackPolicy(org: string, user: string) {
  return run(org, user, async db => { const config = await db.websiteReceptionistConfig.findUnique({ where: { organizationId: org }, select: { feedbackEnabled: true, updatedAt: true } }); return feedbackPolicySchema.parse({ configured: !!config, enabled: config?.feedbackEnabled ?? false, updatedAt: config?.updatedAt.toISOString() ?? null }) })
}
export async function saveVisitorFeedbackPolicy(org: string, user: string, raw: unknown) {
  return run(org, user, async db => {
    const input = feedbackPolicyInputSchema.parse(raw)
    await db.$queryRaw`SELECT id FROM "Organization" WHERE id=${org} FOR NO KEY UPDATE`
    const [config] = await db.$queryRaw<{ feedbackEnabled: boolean; updatedAt: Date }[]>`SELECT "feedbackEnabled","updatedAt" FROM "WebsiteReceptionistConfig" WHERE "organizationId"=${org} FOR UPDATE`
    if (!config) throw new AppError('FEEDBACK_NOT_CONFIGURED', 'Save website receptionist settings before enabling feedback.', 409)
    if (config.updatedAt.toISOString() !== input.expectedUpdatedAt) conflict()
    const saved = config.feedbackEnabled === input.enabled ? config : await db.websiteReceptionistConfig.update({ where: { organizationId: org }, data: { feedbackEnabled: input.enabled, updatedAt: new Date(Math.max(Date.now(), config.updatedAt.getTime() + 1)) }, select: { feedbackEnabled: true, updatedAt: true } })
    return feedbackPolicySchema.parse({ configured: true, enabled: saved.feedbackEnabled, updatedAt: saved.updatedAt.toISOString() })
  })
}
export async function getVisitorFeedbackList(org: string, user: string, raw: unknown) {
  return run(org, user, async db => {
    const input = feedbackQuerySchema.parse(raw)
    const records = await db.websiteReceptionistFeedback.findMany({ where: { organizationId: org, createdAt: { gt: cutoff() }, ...(input.status === 'all' ? {} : { status: input.status }) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (input.page - 1) * 20, take: 21 })
    const documents = await db.knowledgeDocument.findMany({ where: { organizationId: org, id: { in: records.slice(0, 20).flatMap(record => record.faqDocumentId ? [record.faqDocumentId] : []) } }, select: { id: true, archivedAt: true, publishedAt: true, publishedRevision: true, receptionistApprovedRevision: true } })
    return feedbackListSchema.parse({ rows: records.slice(0, 20).map(record => {
      const document = documents.find(value => value.id === record.faqDocumentId)
      const status = !document ? 'unavailable' : document.archivedAt ? 'archived' : !document.publishedAt ? 'draft' : document.publishedRevision !== null && document.receptionistApprovedRevision === document.publishedRevision ? 'approved' : 'published'
      return { id: record.id, question: record.question, siteOrigin: record.siteOrigin, status: record.status, createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString(), consentedAt: record.consentedAt.toISOString(), expiresAt: new Date(record.createdAt.getTime() + FEEDBACK_RETENTION_DAYS * 86400000).toISOString(), faq: record.faqDocumentId ? { documentId: record.faqDocumentId, knowledgeUrl: `/knowledge?document=${record.faqDocumentId}`, status } : null }
    }), page: input.page, pageSize: 20, hasMore: records.length > 20 })
  })
}
export async function changeVisitorFeedback(org: string, user: string, id: string, raw: unknown) {
  return run(org, user, async db => {
    const input = feedbackActionSchema.parse(raw), record = await row(db, org, id)
    if (record.updatedAt.toISOString() !== input.expectedUpdatedAt) conflict()
    if (input.action === 'delete') await db.websiteReceptionistFeedback.delete({ where: { id: record.id } })
    else await db.websiteReceptionistFeedback.update({ where: { id: record.id }, data: { status: input.action === 'dismiss' ? 'dismissed' : 'open', updatedAt: new Date(Math.max(Date.now(), record.updatedAt.getTime() + 1)) } })
    return { saved: true as const }
  })
}
export async function createVisitorFeedbackFaq(org: string, user: string, id: string, raw: unknown) {
  return run(org, user, async db => {
    const input = feedbackFaqInputSchema.parse(raw)
    await db.$queryRaw`SELECT id FROM "Organization" WHERE id=${org} FOR NO KEY UPDATE`
    const record = await row(db, org, id)
    if (record.faqDocumentId) { const document = await db.knowledgeDocument.findFirst({ where: { id: record.faqDocumentId, organizationId: org }, select: { id: true } }); return feedbackFaqSchema.parse({ documentId: record.faqDocumentId, knowledgeUrl: `/knowledge?document=${record.faqDocumentId}`, created: false, available: !!document }) }
    if (record.updatedAt.toISOString() !== input.expectedUpdatedAt) conflict()
    if (await db.knowledgeDocument.count({ where: { organizationId: org, archivedAt: null } }) >= 50) throw new AppError('KNOWLEDGE_LIMIT', 'The library supports up to 50 active documents. Archive one before adding another.', 400)
    const document = await db.knowledgeDocument.create({ data: { organizationId: org, createdById: user, title: `FAQ: ${record.question.replace(/\s+/g, ' ')}`.slice(0, 160), category: 'FAQ', contentText: `Question: ${record.question}\n\nAnswer:\n` } })
    await db.websiteReceptionistFeedback.update({ where: { id }, data: { faqDocumentId: document.id, updatedAt: new Date(Math.max(Date.now(), record.updatedAt.getTime() + 1)) } })
    await db.auditEntry.create({ data: { organizationId: org, userId: user, action: 'CREATE', entityType: 'KnowledgeDocument', entityId: document.id, changes: { revision: document.revision } } })
    return feedbackFaqSchema.parse({ documentId: document.id, knowledgeUrl: `/knowledge?document=${document.id}`, created: true, available: true })
  })
}
