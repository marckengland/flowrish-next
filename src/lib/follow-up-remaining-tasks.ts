import { z } from 'zod'
import { taskCompletionPreview } from './follow-up-task-completion'
import { taskReschedulePreview, taskRescheduleTarget } from './follow-up-task-reschedule'
export const remainingTaskInput = z.object({ indices: z.array(z.number().int().min(0).max(19)).min(1).max(20).refine(rows => new Set(rows).size === rows.length, 'Select each task once.'), target: taskRescheduleTarget.optional() }).strict()
const skipped = z.array(z.object({ index: z.number().int().min(0).max(19), reason: z.enum(['confirmed', 'uncertain', 'unavailable', 'completed', 'changed']) }).strict()).max(20)
export const remainingTaskReview = z.discriminatedUnion('kind', [
 z.object({ batchId: z.string().uuid(), kind: z.literal('COMPLETE'), checkedAt: z.string().datetime(), items: z.array(z.object({ index: z.number().int().min(0).max(19), preview: taskCompletionPreview }).strict()).max(20), skipped }).strict(),
 z.object({ batchId: z.string().uuid(), kind: z.literal('RESCHEDULE'), checkedAt: z.string().datetime(), items: z.array(z.object({ index: z.number().int().min(0).max(19), preview: taskReschedulePreview }).strict()).max(20), skipped }).strict(),
])
export type RemainingTaskReview = z.infer<typeof remainingTaskReview>
