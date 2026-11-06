'use client'
import { z } from 'zod'
import { taskCompletionInput, taskCompletionPreview, taskCompletionReceipt, type TaskCompletionReceipt } from './follow-up-task-completion'
import type {TaskProgress} from './follow-up-task-progress'
import { followUpHeaders, type FollowUpContext } from './follow-up-access'
import { followUpData, followUpAccessLost, FollowUpClientError } from './follow-up-client'
export const BULK_TASK_COMPLETION_LIMIT = 20
const id = z.string().min(1).max(128)
const selection = z.array(id).min(1).max(BULK_TASK_COMPLETION_LIMIT).refine(rows => new Set(rows).size === rows.length, 'Select each follow-up once.')
const entry = z.object({ id, listKey: z.string().max(4096), input: taskCompletionInput }).strict()
const entries = z.array(entry).min(1).max(BULK_TASK_COMPLETION_LIMIT).refine(rows => new Set(rows.map(row => row.id)).size === rows.length && new Set(rows.map(row => row.input.requestId)).size === rows.length && new Set(rows.map(row => row.input.taskId)).size === rows.length, 'Use unique follow-ups and requests.')
export type BulkTaskCompletionPlan = z.infer<typeof entries>
export type BulkTaskCompletionOutcome = { id: string; state: 'completed' | 'verified' | 'failed' | 'unconfirmed' | 'not-attempted' | 'not-recorded'; message: string }
type Hooks = { active: () => boolean; signal?: AbortSignal; onChanged: (receipt: Extract<TaskCompletionReceipt, { state: 'confirmed' }>) => void; onAccessLost?: (cause: unknown, id: string) => void; onProgress?: (rows: BulkTaskCompletionOutcome[]) => void; isCurrent?: (row: BulkTaskCompletionPlan[number]) => boolean }
export function makeBulkTaskCompletionPlan(raw: unknown): BulkTaskCompletionPlan { return entries.parse(raw) }
export type CompletionItem = { id: string; status: string; taskId: string | null; taskProgress?: TaskProgress; title?: string; lead?: { firstName: string; lastName: string } }
export const canBulkCompleteTask = (row: CompletionItem) => row.status === 'APPROVED' && Boolean(row.taskId && row.taskProgress && ['OPEN','OVERDUE'].includes(row.taskProgress.state))
export const completionListKey = (row: CompletionItem) => JSON.stringify([row.taskId,row.status,row.taskProgress?.state,row.taskProgress?.state !== 'UNAVAILABLE' ? row.taskProgress?.dueDate : null,row.title,row.lead?.firstName,row.lead?.lastName])
export function uniqueCompletionSelection(items: readonly CompletionItem[], blockedIds: readonly string[] = []) {
 const blocked=new Set(blockedIds),tasks=new Set<string>(),ids:string[]=[]
 for(const row of items)if(canBulkCompleteTask(row)&&!blocked.has(row.id)&&!tasks.has(row.taskId!)){tasks.add(row.taskId!);ids.push(row.id);if(ids.length===BULK_TASK_COMPLETION_LIMIT)break}
 return ids
}
async function request(id: string, context: FollowUpContext, method: 'GET' | 'POST', body: unknown, signal?: AbortSignal, requestId?: string) {
 const controller = new AbortController(), abort = () => controller.abort(), timer = setTimeout(abort, 25000)
 if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true })
 try {
  const response = await fetch(`/api/follow-ups/${encodeURIComponent(id)}/task-completion${requestId ? `?requestId=${encodeURIComponent(requestId)}` : ''}`, { method, cache: 'no-store', headers: { ...followUpHeaders(context), ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}), signal: controller.signal })
  const result = await followUpData(response, context)
  if (result.canWrite !== true) throw new FollowUpClientError('Editing access changed. Reload before continuing.', 403, 'FORBIDDEN')
  return result.data
 } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
}
export async function previewBulkTaskCompletion(raw: unknown, context: FollowUpContext, hooks: Pick<Hooks, 'active' | 'signal' | 'onAccessLost'>) {
 context = { ...context }
 const selected = selection.parse(raw), rows: z.infer<typeof taskCompletionPreview>[] = []
 for (const id of selected) {
  if (!hooks.active() || hooks.signal?.aborted) return []
  try {
   const row = taskCompletionPreview.parse(await request(id, context, 'GET', undefined, hooks.signal))
   if (!hooks.active() || hooks.signal?.aborted) return []
   if (row.id !== id || rows.some(previous => previous.task.id === row.task.id)) throw new Error('This review could not be confirmed. Refresh and review again.')
   rows.push(row)
  } catch (cause) { if (hooks.active() && followUpAccessLost(cause)) hooks.onAccessLost?.(cause, id); throw cause }
 }
 return rows
}
const outcome = (cause: unknown, id: string, hooks: Hooks): BulkTaskCompletionOutcome => {
 if (followUpAccessLost(cause)) hooks.onAccessLost?.(cause, id)
 const definite = cause instanceof FollowUpClientError && cause.status >= 400 && cause.status < 500
 return { id, state: definite ? 'failed' : 'unconfirmed', message: definite ? cause.message : 'Completion could not be confirmed. Check results before trying again.' }
}
function checkedReceipt(raw: unknown, row: BulkTaskCompletionPlan[number]) {
 const receipt = taskCompletionReceipt.parse(raw)
 if (receipt.id !== row.id || receipt.requestId !== row.input.requestId || receipt.state === 'confirmed' && receipt.task.id !== row.input.taskId) throw new Error('Unexpected completion receipt.')
 return receipt
}
export async function runBulkTaskCompletion(raw: unknown, context: FollowUpContext, hooks: Hooks) {
 context = { ...context }
 const plan = makeBulkTaskCompletionPlan(raw), results: BulkTaskCompletionOutcome[] = plan.map(row => ({ id: row.id, state: 'not-attempted', message: 'Not attempted.' }))
 for (const [index, row] of plan.entries()) {
  if (!hooks.active() || hooks.signal?.aborted) break
  if (hooks.isCurrent && !hooks.isCurrent(row)) { results[index] = { id: row.id, state: 'not-attempted', message: 'Not attempted: the selected task changed. Review again.' }; hooks.onProgress?.([...results]); break }
  try {
   const receipt = checkedReceipt(await request(row.id, context, 'POST', row.input, hooks.signal), row)
   if (!hooks.active()) break
   if (receipt.state !== 'confirmed') throw new Error('Completion not confirmed')
   hooks.onChanged(receipt); results[index] = { id: row.id, state: 'completed', message: 'Task completion confirmed.' }
  } catch (cause) { if (!hooks.active()) break; results[index] = outcome(cause, row.id, hooks); if (hooks.active()) hooks.onProgress?.([...results]); break }
  if (hooks.active()) hooks.onProgress?.([...results])
 }
 return results
}
export async function verifyBulkTaskCompletion(raw: unknown, previous: BulkTaskCompletionOutcome[], context: FollowUpContext, hooks: Hooks) {
 context = { ...context }
 const plan = makeBulkTaskCompletionPlan(raw), results = previous.map(row => ({ ...row }))
 if (results.length !== plan.length || results.some((row, i) => row.id !== plan[i].id)) throw new Error('The reviewed batch changed.')
 for (const [index, row] of plan.entries()) {
  if (!hooks.active() || hooks.signal?.aborted) break
  if (!['unconfirmed', 'failed'].includes(results[index].state)) continue
  try {
   const receipt = checkedReceipt(await request(row.id, context, 'GET', undefined, hooks.signal, row.input.requestId), row)
   if (!hooks.active()) break
   if (receipt.state === 'confirmed') { hooks.onChanged(receipt); results[index] = { id: row.id, state: 'verified', message: 'Requested task completion verified.' } }
   else results[index] = { id: row.id, state: 'not-recorded', message: receipt.state === 'changed' ? 'The completed task changed. Review it in CRM before another attempt.' : 'No matching confirmation found. Refresh and review before another attempt.' }
  } catch (cause) { if (!hooks.active()) break; results[index] = outcome(cause, row.id, hooks); if (hooks.active()) hooks.onProgress?.([...results]); break }
  if (hooks.active()) hooks.onProgress?.([...results])
 }
 return results
}
