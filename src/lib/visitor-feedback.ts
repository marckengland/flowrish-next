import { z } from 'zod'
import { websiteOriginSchema } from './website-receptionist'
export { FEEDBACK_RETENTION_DAYS } from './visitor-feedback-retention'
export const FEEDBACK_DAILY_LIMIT = 50
const version = z.string().datetime(), id = z.string().uuid()
export const feedbackInputSchema = z.object({ requestId: id, question: z.string().trim().min(1).max(1000).refine(value => !value.includes('\0') && new TextEncoder().encode(value).length <= 2000, 'Use a shorter question without unsupported text.'), consented: z.literal(true), website: z.literal('') }).strict()
export const feedbackPolicyInputSchema = z.object({ enabled: z.boolean(), acknowledged: z.boolean(), expectedUpdatedAt: version }).strict().refine(value => !value.enabled || value.acknowledged, 'Review question saving before enabling feedback.')
export const feedbackPolicySchema = z.object({ configured: z.boolean(), enabled: z.boolean(), updatedAt: version.nullable() }).strict().refine(value => value.configured === (value.updatedAt !== null) && (value.configured || !value.enabled), 'Invalid feedback settings.')
export const feedbackQuerySchema = z.object({ status: z.enum(['open', 'dismissed', 'all']).default('open'), page: z.coerce.number().int().min(1).max(10000).default(1) }).strict()
export const feedbackActionSchema = z.object({ action: z.enum(['dismiss', 'reopen', 'delete']), expectedUpdatedAt: version }).strict()
export const feedbackFaqInputSchema = z.object({ expectedUpdatedAt: version }).strict()
export const feedbackFaqSchema = z.object({ documentId: id, knowledgeUrl: z.string(), available: z.boolean(), created: z.boolean() }).strict().refine(value => value.knowledgeUrl === `/knowledge?document=${value.documentId}`, 'Invalid Library link.')
const faq = z.object({ documentId: id, knowledgeUrl: z.string(), status: z.enum(['draft', 'published', 'approved', 'archived', 'unavailable']) }).strict().refine(value => value.knowledgeUrl === `/knowledge?document=${value.documentId}`, 'Invalid Library link.')
export const feedbackRecordSchema = z.object({ id, question: feedbackInputSchema.shape.question, siteOrigin: websiteOriginSchema, status: z.enum(['open', 'dismissed']), createdAt: version, updatedAt: version, consentedAt: version, expiresAt: version, faq: faq.nullable() }).strict()
export const feedbackListSchema = z.object({ rows: z.array(feedbackRecordSchema).max(20), page: z.number().int().positive(), pageSize: z.literal(20), hasMore: z.boolean() }).strict()
export type VisitorFeedbackList = z.infer<typeof feedbackListSchema>
export type VisitorFeedbackPolicy = z.infer<typeof feedbackPolicySchema>
