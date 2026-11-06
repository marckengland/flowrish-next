import { z } from 'zod'
export const FOLLOW_UP_TASK_PROGRESS_HEADER = 'x-flowrish-task-progress'
export const taskProgressFilter = z.enum(['OPEN', 'OVERDUE', 'COMPLETED'])
export const taskProgressSchema = z.discriminatedUnion('state', [z.object({ state: z.literal('UNAVAILABLE') }).strict(), z.object({ state: taskProgressFilter, dueDate: z.string().datetime(), completedAt: z.string().datetime().nullable(), checkedAt: z.string().datetime() }).strict()])
export type TaskProgress = z.infer<typeof taskProgressSchema>
export function taskProgressFromRequest(request: Request) { const value = request.headers.get(FOLLOW_UP_TASK_PROGRESS_HEADER); if (value === null) return false; z.literal('1').parse(value); return true }
export function filtersForFollowUpTab<T extends { dueOnly: boolean; taskProgress?: z.infer<typeof taskProgressFilter>; taskOrder?: 'DUE_ASC' }>(filters: T, status: string): T {
 const { taskProgress, taskOrder, ...rest } = filters
 return { ...rest, dueOnly: status === 'PENDING' && filters.dueOnly, ...(status === 'APPROVED' && taskProgress ? { taskProgress } : {}), ...(status === 'APPROVED' && taskOrder ? { taskOrder } : {}) } as T
}
