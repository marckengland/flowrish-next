import { z } from 'zod'

export const faqDraftInputSchema = z.object({ messageIndex: z.number().int().min(0).max(28), expectedUpdatedAt: z.string().datetime() }).strict()
export const faqDraftResultSchema = z.object({
  documentId: z.string().uuid(), knowledgeUrl: z.string(), created: z.boolean(),
}).strict().refine(value => value.knowledgeUrl === `/knowledge?document=${value.documentId}`, 'Invalid knowledge link.')
export const faqOriginSchema = z.object({
  rehearsalId: z.string().uuid(), title: z.string().min(1).max(120), messageIndex: z.number().int().min(0).max(28), rehearsalUrl: z.string(),
}).strict().refine(value => value.rehearsalUrl === `/settings?section=receptionist&rehearsal=${value.rehearsalId}`, 'Invalid rehearsal link.')
export type FaqDraftResult = z.infer<typeof faqDraftResultSchema>
export type FaqOrigin = z.infer<typeof faqOriginSchema>
