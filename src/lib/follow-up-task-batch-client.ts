'use client'
import { taskBatchRegistration, taskBatchAck, TASK_BATCH_EVENT } from './follow-up-task-batches'
import { followUpHeaders, type FollowUpContext } from './follow-up-access'
import { followUpData, followUpAccessLost, FollowUpClientError } from './follow-up-client'
export const taskBatchChanged = () => window.dispatchEvent(new Event(TASK_BATCH_EVENT))
export async function saveTaskBatchIntent(raw: unknown, context: FollowUpContext, hooks: { active: () => boolean; signal?: AbortSignal; onAccessLost?: (cause: unknown, id: string) => void }) {
 const registration = taskBatchRegistration.parse(raw), controller = new AbortController(), abort = () => controller.abort(), timer = setTimeout(abort, 25000)
 if (hooks.signal?.aborted) abort(); else hooks.signal?.addEventListener('abort', abort, { once: true })
 try {
  if (!hooks.active() || controller.signal.aborted) throw new Error('Inactive batch')
  const result = await followUpData(await fetch('/api/follow-ups/batches', { method: 'POST', cache: 'no-store', headers: { ...followUpHeaders(context), 'Content-Type': 'application/json' }, body: JSON.stringify(registration), signal: controller.signal }), context)
  if (result.canWrite !== true) throw new FollowUpClientError('Editing access changed. Reload before continuing.', 403, 'FORBIDDEN')
  const ack = taskBatchAck.parse(result.data)
  if (!hooks.active() || controller.signal.aborted || JSON.stringify(ack.registration) !== JSON.stringify(registration)) throw new Error('Unexpected batch receipt')
  taskBatchChanged()
  return registration.id
 } catch (cause) {
  if (hooks.active() && followUpAccessLost(cause) && !(cause instanceof FollowUpClientError && cause.status === 404)) hooks.onAccessLost?.(cause, registration.items[0].id)
  throw new Error('Batch saving could not be confirmed. No task requests were started. Check saved bulk-action history, then make a new review.')
 } finally { clearTimeout(timer); hooks.signal?.removeEventListener('abort', abort) }
}
