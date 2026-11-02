import { z } from 'zod'

export const REHEARSAL_MAX_BYTES = 96 * 1024
const messageSchema = z.object({
  role: z.enum(['caller', 'receptionist']),
  content: z.string().trim().min(1).max(4096),
  sources: z.array(z.object({ id: z.string().uuid(), title: z.string().trim().min(1).max(200), revision: z.number().int().positive() }).strict()).max(8),
  generation: z.enum(['scripted', 'ai', 'fallback']),
}).strict().superRefine((message, ctx) => {
  if (message.role === 'caller' && (message.sources.length || message.generation !== 'scripted')) ctx.addIssue({ code: 'custom', message: 'Caller messages cannot have AI metadata.' })
})

export const rehearsalSnapshotSchema = z.object({
  clientId: z.string().uuid(),
  settingsVersion: z.string().datetime(),
  finished: z.boolean(),
  messages: z.array(messageSchema).min(1).max(29),
}).strict().refine(value => new TextEncoder().encode(JSON.stringify(value)).length <= REHEARSAL_MAX_BYTES, 'This rehearsal is too large to save.')

export const rehearsalReviewSchema = z.object({
  verdict: z.enum(['unreviewed', 'passed', 'needs_work']),
  notes: z.string().trim().max(2000),
  unansweredMessageIndexes: z.array(z.number().int().min(0).max(28)).max(14),
}).strict().refine(value => new Set(value.unansweredMessageIndexes).size === value.unansweredMessageIndexes.length, 'Select each question only once.')

export type RehearsalMessage = z.infer<typeof messageSchema>
export type RehearsalSnapshot = z.infer<typeof rehearsalSnapshotSchema>
export type RehearsalReview = z.infer<typeof rehearsalReviewSchema>
export interface RehearsalSummary extends RehearsalReview { id: string; title: string; createdAt: string; updatedAt: string }
export interface RehearsalReport extends RehearsalSummary { snapshot: RehearsalSnapshot }

export function validateRehearsalReview(input: unknown, messages: ReadonlyArray<{ role: string }>): RehearsalReview {
  const review = rehearsalReviewSchema.parse(input)
  if (review.unansweredMessageIndexes.some(index => messages[index]?.role !== 'caller')) throw new z.ZodError([{ code: 'custom', path: ['unansweredMessageIndexes'], message: 'Only caller questions can be flagged for knowledge.' }])
  return review
}
