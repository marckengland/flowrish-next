import { z } from 'zod'
export const followUpHistoryQuery = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1) }).strict()
export const followUpHistoryEntry = z.object({ id: z.string().uuid(), kind: z.enum(['approved','dismissed','snoozed','woke']), actor: z.literal('You'), occurredAt: z.string().datetime(), until: z.string().datetime().nullable(), timeZone: z.string().min(1).max(100).nullable() }).strict()
export const followUpHistoryData = z.object({ id: z.string().min(1).max(128), page: z.number().int().min(1).max(10000), hasMore: z.boolean(), entries: z.array(followUpHistoryEntry).max(20), current: z.object({ state: z.enum(['pending','snoozed','due','approved','dismissed']), until: z.string().datetime().nullable(), timeZone: z.string().min(1).max(100).nullable(), checkedAt: z.string().datetime() }).strict() }).strict()
export type FollowUpHistoryData = z.infer<typeof followUpHistoryData>
export const followUpHistoryAction = (kind: z.infer<typeof followUpHistoryEntry>['kind']) => ({ approved: 'Approved follow-up', dismissed: 'Dismissed follow-up', snoozed: 'Snoozed follow-up', woke: 'Woke follow-up' })[kind]
