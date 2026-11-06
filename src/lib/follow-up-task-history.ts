import { z } from 'zod'
export const taskHistoryQuery = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1) }).strict()
const base = z.object({ id: z.string().uuid(), actor: z.string().min(1).max(200), occurredAt: z.string().datetime() })
export const taskHistoryEntry = z.discriminatedUnion('kind', [
 base.extend({ kind: z.literal('completed') }).strict(),
 base.extend({ kind: z.literal('rescheduled'), previousDueDate: z.string().datetime(), dueDate: z.string().datetime() }).strict(),
])
export const taskHistoryData = z.object({ id: z.string().min(1).max(128), taskId: z.string().min(1).max(128), page: z.number().int().min(1).max(10000), hasMore: z.boolean(), entries: z.array(taskHistoryEntry).max(20), checkedAt: z.string().datetime() }).strict()
export type TaskHistoryData = z.infer<typeof taskHistoryData>
