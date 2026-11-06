'use client'
import { resolveLocalMinute } from './callback-time'
import { type FollowUpContext, followUpHeaders } from './follow-up-access'
import { followUpData, FollowUpClientError } from './follow-up-client'
import type { TaskBatchDetail } from './follow-up-task-batches'
import { remainingTaskInput, remainingTaskReview } from './follow-up-remaining-tasks'
export async function fetchRemainingTaskReview(detail: TaskBatchDetail, raw: unknown, context: FollowUpContext, hooks: { active: () => boolean; signal?: AbortSignal }) {
 const input = remainingTaskInput.parse(raw), query = new URLSearchParams()
 for (const index of input.indices) query.append('index', String(index))
 if (detail.kind === 'COMPLETE' && input.target || detail.kind === 'RESCHEDULE' && !input.target) throw new Error('Choose a new deadline for the remaining tasks.')
 if (input.target) {
  if (resolveLocalMinute(input.target.localTime, input.target.timeZone) <= Date.now()) throw new Error('Choose a future deadline.')
  query.set('localTime', input.target.localTime); query.set('timeZone', input.target.timeZone)
 }
 const controller = new AbortController(), abort = () => controller.abort(), timer = setTimeout(abort, 25000)
 if (hooks.signal?.aborted) abort(); else hooks.signal?.addEventListener('abort', abort, { once: true })
 try {
  if (!hooks.active() || controller.signal.aborted) throw new Error('This review is no longer active.')
  const data = await followUpData(await fetch(`/api/follow-ups/batches/${encodeURIComponent(detail.id)}/review?${query}`, { method: 'GET', cache: 'no-store', headers: followUpHeaders(context), signal: controller.signal }), context)
  if (data.canWrite !== true) throw new FollowUpClientError('Editing access changed. Reload before continuing.', 403, 'FORBIDDEN')
  const result = remainingTaskReview.parse(data.data), indices = [...result.items.map(row => row.index), ...result.skipped.map(row => row.index)]
  if (!hooks.active() || controller.signal.aborted || result.batchId !== detail.id || result.kind !== detail.kind || indices.length !== input.indices.length || new Set(indices).size !== indices.length || indices.some(index => !input.indices.includes(index)) || new Set(result.items.map(row => row.preview.id)).size !== result.items.length || new Set(result.items.map(row => row.preview.task.id)).size !== result.items.length) throw new Error('This review could not be confirmed. Check history and review again.')
  for (const entry of result.items) {
   const current = detail.items.find(row => row.index === entry.index)
   if (!current || current.state === 'unavailable' || !['failed','not-attempted'].includes(current.state) || current.task.isComplete || current.task.id !== entry.preview.task.id) throw new Error('Selected tasks changed. Check history and review again.')
   if (result.kind === 'RESCHEDULE') {
    const preview = result.items.find(row => row.index === entry.index)!.preview
    if (preview.localTime !== input.target?.localTime || preview.timeZone !== input.target.timeZone || preview.newDueDate !== new Date(resolveLocalMinute(input.target.localTime, input.target.timeZone)).toISOString()) throw new Error('The reviewed deadline changed. Review again.')
   }
  }
  return result
 } finally { clearTimeout(timer); hooks.signal?.removeEventListener('abort', abort) }
}
