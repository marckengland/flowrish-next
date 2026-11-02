import { z } from 'zod'

export const gapKeySchema = z.string().regex(/^[a-f0-9]{64}$/)
export const gapPageSchema = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1) }).strict()
export const gapListQuerySchema = gapPageSchema.extend({ status: z.enum(['open', 'resolved', 'all']).default('open') })
export const gapFaqInputSchema = z.object({ expectedVersion: gapKeySchema }).strict()
export const gapReviewInputSchema = z.object({
  expectedVersion: gapKeySchema, action: z.enum(['resolve', 'reopen']), retested: z.boolean(), notes: z.string().trim().max(2000).refine(value => !value.includes('\0'), 'Unsupported review text.'),
}).strict().refine(value => value.action !== 'resolve' || value.retested, 'Confirm that you manually retested this question before resolving it.')

export const gapFaqStatusSchema = z.enum(['draft', 'published', 'approved', 'archived'])
export const gapGroupSchema = z.object({
  key: gapKeySchema, version: gapKeySchema, question: z.string().min(1).max(4096), occurrenceCount: z.number().int().positive(), latestAt: z.string().datetime(), status: z.enum(['open', 'resolved']), changedSinceResolution: z.boolean(),
  faqCounts: z.object({ draft: z.number().int().nonnegative(), published: z.number().int().nonnegative(), approved: z.number().int().nonnegative(), archived: z.number().int().nonnegative() }).strict(),
  resolution: z.object({ notes: z.string().max(2000), resolvedAt: z.string().datetime().nullable() }).strict().nullable(),
}).strict()
export const gapOccurrenceSchema = z.object({
  rehearsalId: z.string().uuid(), title: z.string().min(1).max(120), messageIndex: z.number().int().min(0).max(28), updatedAt: z.string().datetime(), rehearsalUrl: z.string(),
  faq: z.object({ documentId: z.string().uuid(), title: z.string().min(1).max(160), status: gapFaqStatusSchema, knowledgeUrl: z.string() }).strict().refine(value => value.knowledgeUrl === `/knowledge?document=${value.documentId}`, 'Invalid knowledge link.').nullable(),
}).strict().refine(value => value.rehearsalUrl === `/settings?section=receptionist&rehearsal=${value.rehearsalId}`, 'Invalid rehearsal link.')

export const gapListSchema = z.object({ groups: z.array(gapGroupSchema).max(20), page: z.number().int().positive(), pageSize: z.literal(20), hasMore: z.boolean() }).strict()
export const gapDetailSchema = z.object({ group: gapGroupSchema, occurrences: z.array(gapOccurrenceSchema).max(20), page: z.number().int().positive(), pageSize: z.literal(20), hasMore: z.boolean() }).strict()
export type KnowledgeGapGroup = z.infer<typeof gapGroupSchema>
export type KnowledgeGapOccurrence = z.infer<typeof gapOccurrenceSchema>
export type KnowledgeGapList = z.infer<typeof gapListSchema>
export type KnowledgeGapDetail = z.infer<typeof gapDetailSchema>
