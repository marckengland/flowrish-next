import 'server-only'
import { z } from 'zod'
import { prisma } from '@/server/db/client'
import { AppError } from '@/lib/errors'
import { resolveLocalMinute } from '@/lib/callback-time'
import { taskBatchRegistration, type TaskBatchDetail } from '@/lib/follow-up-task-batches'
import { remainingTaskInput, remainingTaskReview } from '@/lib/follow-up-remaining-tasks'
import { currentFollowUpAccess, followUpChanged, followUpUnavailable, lockFollowUpMember, requireFollowUpWrites, safeFollowUp } from './follow-up-access'
import { readTaskBatch } from './follow-up-task-batches'
import { previewTaskCompletion } from './follow-up-task-completion'
import { previewTaskReschedule } from './follow-up-task-reschedule'
type Reason = 'confirmed' | 'uncertain' | 'unavailable' | 'completed' | 'changed'
function excluded(detail: TaskBatchDetail, index: number): Reason | null {
 const row = detail.items.find(row => row.index === index)
 if (!row || row.state === 'unavailable') return 'unavailable'
 if (row.state === 'confirmed' || row.state === 'uncertain') return row.state
 return row.task.isComplete ? 'completed' : null
}
export async function reviewRemainingTasks(organizationId: string, userId: string, id: string, raw: unknown) {
 z.string().uuid().parse(id)
 const input = remainingTaskInput.parse(raw); requireFollowUpWrites()
 return safeFollowUp(async () => {
  const plan = await prisma.$transaction(async db => {
   await lockFollowUpMember(db, organizationId, userId); await currentFollowUpAccess(db, organizationId, userId, true)
   const row = await db.followUpTaskBatch.findFirst({ where: { id, organizationId, userId } })
   if (!row) throw followUpUnavailable()
   return taskBatchRegistration.parse({ id, kind: row.kind, items: row.plan })
  })
  if (input.indices.some(index => index >= plan.items.length)) throw new AppError('VALIDATION_ERROR', 'Choose tasks from this saved batch.', 400)
  if (plan.kind === 'COMPLETE' && input.target || plan.kind === 'RESCHEDULE' && !input.target) throw new AppError('VALIDATION_ERROR', 'Choose a new deadline for rescheduling only.', 400)
  if (input.target) {
   try { if (resolveLocalMinute(input.target.localTime, input.target.timeZone) <= Date.now()) throw new RangeError() }
   catch { throw new AppError('VALIDATION_ERROR', 'Choose a valid future deadline and timezone.', 400) }
  }
  const before = await readTaskBatch(organizationId, userId, id)
  if (!before.canReview) throw new AppError('FORBIDDEN', 'Editing access changed. Refresh before reviewing.', 403)
  const items: Array<{ index: number; preview: Awaited<ReturnType<typeof previewTaskCompletion>> | Awaited<ReturnType<typeof previewTaskReschedule>> }> = [], skipped: Array<{ index: number; reason: Reason }> = []
  for (const index of input.indices) {
   const reason = excluded(before, index)
   if (reason) { skipped.push({ index, reason }); continue }
   const entry = plan.items[index]
   try {
    const preview = plan.kind === 'COMPLETE' ? await previewTaskCompletion(organizationId, userId, entry.id) : await previewTaskReschedule(organizationId, userId, entry.id, input.target)
    if (preview.id !== entry.id || preview.task.id !== entry.input.taskId) throw followUpChanged()
    items.push({ index, preview })
   } catch (cause) {
    if (cause instanceof AppError && [400, 404].includes(cause.statusCode)) skipped.push({ index, reason: cause.statusCode === 404 ? 'unavailable' : 'changed' })
    else throw cause
   }
  }
  // An original request may have finished while previews were loading. Never replay it.
  const after = await readTaskBatch(organizationId, userId, id)
  if (!after.canReview) throw new AppError('FORBIDDEN', 'Editing access changed. Refresh before reviewing.', 403)
  const ready = items.filter(item => {
   const reason = excluded(after, item.index)
   if (reason) { skipped.push({ index: item.index, reason }); return false }
   const row = after.items.find(row => row.index === item.index)!
   if (row.state === 'unavailable' || row.task.id !== item.preview.task.id) { skipped.push({ index: item.index, reason: 'unavailable' }); return false }
   return true
  })
  return remainingTaskReview.parse({ batchId: id, kind: plan.kind, checkedAt: after.checkedAt, items: ready, skipped: skipped.sort((a,b) => a.index - b.index) })
 })
}
