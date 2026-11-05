import { z } from 'zod'
export const MERGE_USER_HEADER = 'x-flowrish-merge-user'
export const MERGE_RELATED_LIMIT = 500
export const mergePreviewInput = z.object({ id: z.string().uuid(), primaryId: z.string().uuid(), secondaryId: z.string().uuid() }).strict().refine(value => value.primaryId !== value.secondaryId, 'Choose two different leads.')
export const mergeApplyInput = z.object({ id: z.string().uuid(), confirmed: z.literal(true) }).strict()
export const mergeCounts = z.object({ Activity: z.number().int().nonnegative(), Task: z.number().int().nonnegative(), StageTransition: z.number().int().nonnegative(), ScoreHistory: z.number().int().nonnegative(), LeadContact: z.number().int().nonnegative() }).strict()
export const mergeResult = z.object({ state: z.literal('applied'), id: z.string().uuid(), primaryId: z.string().uuid(), secondaryId: z.string().uuid(), counts: mergeCounts, appliedAt: z.string().datetime() }).strict()
export const mergePreview = z.object({ state: z.literal('preview'), id: z.string().uuid(), primaryId: z.string().uuid(), secondaryId: z.string().uuid(), primaryLabel: z.string(), secondaryLabel: z.string(), expiresAt: z.string().datetime(), fields: z.array(z.object({ key: z.string(), label: z.string(), primary: z.string(), secondary: z.string(), different: z.boolean() }).strict()), counts: mergeCounts, blockers: z.array(z.string()) }).strict()
export const mergeResponse = z.discriminatedUnion('state', [mergePreview, mergeResult])
export const duplicateMatches = z.array(z.object({ leadId: z.string().uuid(), leadName: z.string(), matchType: z.enum(['email', 'company']), matchValue: z.string() }).strict()).max(50)
export type MergePreview = z.infer<typeof mergePreview>
export type MergeResult = z.infer<typeof mergeResult>
