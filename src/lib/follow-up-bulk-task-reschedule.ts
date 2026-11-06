'use client'
import { z } from 'zod'
import { taskRescheduleInput, taskReschedulePreview, taskRescheduleReceipt, taskRescheduleTarget, type TaskRescheduleReceipt } from './follow-up-task-reschedule'
import { resolveLocalMinute } from './callback-time'
import { followUpHeaders, type FollowUpContext } from './follow-up-access'
import { followUpData, followUpAccessLost, FollowUpClientError } from './follow-up-client'
export const BULK_TASK_RESCHEDULE_LIMIT = 20
const id = z.string().min(1).max(128)
const selection = z.array(id).min(1).max(BULK_TASK_RESCHEDULE_LIMIT).refine(rows => new Set(rows).size === rows.length, 'Select each follow-up once.')
const entry = z.object({ id, listKey: z.string().max(4096), previousDueDate: z.string().datetime(), dueDate: z.string().datetime(), input: taskRescheduleInput }).strict()
const entries = z.array(entry).min(1).max(BULK_TASK_RESCHEDULE_LIMIT).refine(rows => new Set(rows.map(row => row.id)).size === rows.length && new Set(rows.map(row => row.input.requestId)).size === rows.length && new Set(rows.map(row => row.input.taskId)).size === rows.length, 'Use unique follow-ups and requests.')
export type BulkTaskReschedulePlan = z.infer<typeof entries>
export type BulkTaskRescheduleOutcome = { id: string; state: 'rescheduled' | 'verified' | 'failed' | 'unconfirmed' | 'not-attempted' | 'not-recorded'; message: string }
type Hooks = { active: () => boolean; signal?: AbortSignal; onChanged: (receipt: Extract<TaskRescheduleReceipt, { state: 'confirmed' }>) => void; onAccessLost?: (cause: unknown, id: string) => void; onProgress?: (rows: BulkTaskRescheduleOutcome[]) => void; isCurrent?: (row: BulkTaskReschedulePlan[number]) => boolean }
function chosenTarget(raw: unknown, future: boolean) {
 const value=taskRescheduleTarget.parse(raw),dueDate=new Date(resolveLocalMinute(value.localTime,value.timeZone)).toISOString()
 if(future&&Date.parse(dueDate)<=Date.now())throw new Error('Choose a future deadline.')
 return {...value,dueDate}
}
export function makeBulkTaskReschedulePlan(raw: unknown): BulkTaskReschedulePlan {
 const plan=entries.parse(raw)
 for(const row of plan){const chosen=chosenTarget({localTime:row.input.localTime,timeZone:row.input.timeZone},false);if(row.dueDate!==chosen.dueDate||row.previousDueDate===row.dueDate)throw new Error('Review a different deadline and its exact timezone conversion.')}
 if(new Set(plan.map(row=>JSON.stringify([row.input.localTime,row.input.timeZone,row.dueDate]))).size!==1)throw new Error('Use one reviewed deadline and timezone for this batch.')
 return plan
}
// Both actions select currently authorized open Approved tasks.
export { canBulkCompleteTask as canBulkRescheduleTask, uniqueCompletionSelection as uniqueRescheduleSelection, completionListKey as rescheduleListKey, type CompletionItem as RescheduleItem } from './follow-up-bulk-task-completion'
async function request(id: string, context: FollowUpContext, method: 'GET' | 'POST', body: unknown, signal?: AbortSignal, requestId?: string, target?: {localTime:string;timeZone:string}) {
 const controller = new AbortController(), abort = () => controller.abort(), timer = setTimeout(abort, 25000)
 if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true })
 try {
  const query = requestId ? new URLSearchParams({requestId}) : target ? new URLSearchParams(target) : null
  const response = await fetch(`/api/follow-ups/${encodeURIComponent(id)}/task-reschedule${query ? `?${query}` : ''}`, { method, cache: 'no-store', headers: { ...followUpHeaders(context), ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}), signal: controller.signal })
  const result = await followUpData(response, context)
  if (result.canWrite !== true) throw new FollowUpClientError('Editing access changed. Reload before continuing.', 403, 'FORBIDDEN')
  return result.data
 } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
}
export async function previewBulkTaskReschedule(raw: unknown, rawTarget: unknown, context: FollowUpContext, hooks: Pick<Hooks, 'active' | 'signal' | 'onAccessLost'>) {
 context = { ...context }
 const chosen=chosenTarget(rawTarget,true)
 const selected = selection.parse(raw), rows: z.infer<typeof taskReschedulePreview>[] = []
 for (const id of selected) {
  if (!hooks.active() || hooks.signal?.aborted) return []
  try {
   const row = taskReschedulePreview.parse(await request(id, context, 'GET', undefined, hooks.signal, undefined, {localTime:chosen.localTime,timeZone:chosen.timeZone}))
   if (!hooks.active() || hooks.signal?.aborted) return []
   if (row.id !== id || row.localTime!==chosen.localTime || row.timeZone!==chosen.timeZone || row.newDueDate!==chosen.dueDate || row.task.dueDate===row.newDueDate || rows.some(previous => previous.task.id === row.task.id)) throw new Error('This review could not be confirmed. Refresh and review again.')
   rows.push(row)
  } catch (cause) { if (hooks.active() && followUpAccessLost(cause)) hooks.onAccessLost?.(cause, id); throw cause }
 }
 return rows
}
const outcome = (cause: unknown, id: string, hooks: Hooks): BulkTaskRescheduleOutcome => {
 if (followUpAccessLost(cause)) hooks.onAccessLost?.(cause, id)
 const definite = cause instanceof FollowUpClientError && cause.status >= 400 && cause.status < 500
 return { id, state: definite ? 'failed' : 'unconfirmed', message: definite ? cause.message : 'Rescheduling could not be confirmed. Check results before trying again.' }
}
function checkedReceipt(raw: unknown, row: BulkTaskReschedulePlan[number]) {
 const receipt = taskRescheduleReceipt.parse(raw)
 if (receipt.id !== row.id || receipt.requestId !== row.input.requestId || receipt.state === 'confirmed' && (receipt.task.id !== row.input.taskId || receipt.task.previousDueDate!==row.previousDueDate || receipt.task.dueDate!==row.dueDate)) throw new Error('Unexpected rescheduling receipt.')
 return receipt
}
export async function runBulkTaskReschedule(raw: unknown, context: FollowUpContext, hooks: Hooks) {
 context = { ...context }
 const plan = makeBulkTaskReschedulePlan(raw), results: BulkTaskRescheduleOutcome[] = plan.map(row => ({ id: row.id, state: 'not-attempted', message: 'Not attempted.' }))
 for (const [index, row] of plan.entries()) {
  if (!hooks.active() || hooks.signal?.aborted) break
  if (Date.parse(row.dueDate)<=Date.now()) { results[index]={id:row.id,state:'not-attempted',message:'Not attempted: the reviewed deadline has passed. Review again.'};hooks.onProgress?.([...results]);break }
  if (hooks.isCurrent && !hooks.isCurrent(row)) { results[index] = { id: row.id, state: 'not-attempted', message: 'Not attempted: the selected task changed. Review again.' }; hooks.onProgress?.([...results]); break }
  try {
   const receipt = checkedReceipt(await request(row.id, context, 'POST', row.input, hooks.signal), row)
   if (!hooks.active()) break
   if (receipt.state !== 'confirmed') throw new Error('Rescheduling not confirmed')
   hooks.onChanged(receipt); results[index] = { id: row.id, state: 'rescheduled', message: 'Task deadline change confirmed.' }
  } catch (cause) { if (!hooks.active()) break; results[index] = outcome(cause, row.id, hooks); if (hooks.active()) hooks.onProgress?.([...results]); break }
  if (hooks.active()) hooks.onProgress?.([...results])
 }
 return results
}
export async function verifyBulkTaskReschedule(raw: unknown, previous: BulkTaskRescheduleOutcome[], context: FollowUpContext, hooks: Hooks) {
 context = { ...context }
 const plan = makeBulkTaskReschedulePlan(raw), results = previous.map(row => ({ ...row }))
 if (results.length !== plan.length || results.some((row, i) => row.id !== plan[i].id)) throw new Error('The reviewed batch changed.')
 for (const [index, row] of plan.entries()) {
  if (!hooks.active() || hooks.signal?.aborted) break
  if (!['unconfirmed', 'failed'].includes(results[index].state)) continue
  try {
   const receipt = checkedReceipt(await request(row.id, context, 'GET', undefined, hooks.signal, row.input.requestId), row)
   if (!hooks.active()) break
   if (receipt.state === 'confirmed') { hooks.onChanged(receipt); results[index] = { id: row.id, state: 'verified', message: 'Requested task deadline change verified.' } }
   else results[index] = { id: row.id, state: 'not-recorded', message: receipt.state === 'changed' ? 'The rescheduled task changed. Review it in CRM before another attempt.' : 'No matching confirmation found. Refresh and review before another attempt.' }
  } catch (cause) { if (!hooks.active()) break; results[index] = outcome(cause, row.id, hooks); if (hooks.active()) hooks.onProgress?.([...results]); break }
  if (hooks.active()) hooks.onProgress?.([...results])
 }
 return results
}
