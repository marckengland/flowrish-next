import { z } from 'zod'

export const waitlistReviewStatusSchema = z.enum([
  'new',
  'reviewed',
  'contacted',
])
export const waitlistQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    reviewStatus: z
      .enum(['all', 'new', 'reviewed', 'contacted'])
      .default('all'),
  })
  .strict()
export const waitlistReviewSchema = z
  .object({
    reviewStatus: waitlistReviewStatusSchema,
    expectedVersion: z.number().int().min(0),
  })
  .strict()
export const waitlistEntrySchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
  status: z.string(),
  source: z.string().nullable(),
  reviewStatus: waitlistReviewStatusSchema,
  reviewVersion: z.number().int().min(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
const choice = z.object({ id: z.string().uuid(), label: z.string() })
export const waitlistReceiptSchema = z.object({
  leadId: z.string().uuid(),
  leadAvailable: z.boolean(),
  createdLead: z.boolean(),
  createdAt: z.string().datetime(),
})
export const waitlistListSchema = z.object({
  entries: z.array(waitlistEntrySchema).max(20),
  page: z.number().int().positive(),
  hasNext: z.boolean(),
  canHandoff: z.boolean(),
})
export const waitlistOptionsSchema = z.object({
  entry: waitlistEntrySchema.nullable(),
  receipt: waitlistReceiptSchema.nullable(),
  leads: z.array(choice).max(20),
  members: z.array(choice).max(200),
  stages: z.array(choice).max(200),
  matchesTruncated: z.boolean(),
  choicesTruncated: z.boolean(),
})
export const waitlistHandoffDraftSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    target: z.discriminatedUnion('mode', [
      z
        .object({ mode: z.literal('existing'), leadId: z.string().uuid() })
        .strict(),
      z
        .object({
          mode: z.literal('new'),
          firstName: z.string().trim().min(1).max(120),
          lastName: z.string().trim().max(120),
          stageId: z.string().uuid(),
          assigneeId: z.string().uuid(),
          acknowledgeDuplicate: z.boolean(),
        })
        .strict(),
    ]),
  })
  .strict()
export const waitlistPreviewSchema = z.object({
  version: z.string().regex(/^[a-f0-9]{64}$/),
  organizationName: z.string(),
  action: z.enum(['create', 'link']),
  targetLabel: z.string(),
  email: z.string().email(),
  ownerLabel: z.string().nullable(),
  stageLabel: z.string().nullable(),
})
export const waitlistHandoffCommitSchema = z
  .object({
    draft: waitlistHandoffDraftSchema,
    previewVersion: z.string().regex(/^[a-f0-9]{64}$/),
    confirmed: z.literal(true),
  })
  .strict()
export type WaitlistEntry = z.infer<typeof waitlistEntrySchema>
export type WaitlistList = z.infer<typeof waitlistListSchema>
export type WaitlistOptions = z.infer<typeof waitlistOptionsSchema>
export type WaitlistDraft = z.infer<typeof waitlistHandoffDraftSchema>
export type WaitlistPreview = z.infer<typeof waitlistPreviewSchema>
export type WaitlistReceipt = z.infer<typeof waitlistReceiptSchema>
