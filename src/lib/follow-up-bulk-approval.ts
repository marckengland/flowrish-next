'use client'
import { z } from 'zod'
import { approvalInput, approvalPreview, approvalReceipt, sameApprovalTask, type ApprovalReceipt } from './follow-up-approval'
import { followUpHeaders, type FollowUpContext } from './follow-up-access'
import { followUpData, followUpAccessLost, FollowUpClientError } from './follow-up-client'
export const BULK_APPROVAL_LIMIT = 20
const id = z.string().min(1).max(128)
const selection = z.array(id).min(1).max(BULK_APPROVAL_LIMIT).refine(rows => new Set(rows).size === rows.length, 'Select each follow-up once.')
const entry = z.object({ id, listVersion: z.string().optional(), input: approvalInput }).strict()
const entries = z.array(entry).min(1).max(BULK_APPROVAL_LIMIT).refine(rows => new Set(rows.map(row => row.id)).size === rows.length && new Set(rows.map(row => row.input.requestId)).size === rows.length, 'Use unique follow-ups and requests.')
export type BulkApprovalPlan = z.infer<typeof entries>
export type BulkApprovalOutcome = { id: string; state: 'approved' | 'verified' | 'failed' | 'unconfirmed' | 'not-attempted' | 'not-recorded'; message: string }
type Hooks = { active: () => boolean; signal?: AbortSignal; onChanged: (receipt: Extract<ApprovalReceipt, { state: 'confirmed' }>) => void; onAccessLost?: (cause: unknown, id: string) => void; onProgress?: (rows: BulkApprovalOutcome[]) => void; isCurrent?: (row: BulkApprovalPlan[number]) => boolean }
export function makeBulkApprovalPlan(raw: unknown, context: FollowUpContext): BulkApprovalPlan {
 const plan = entries.parse(raw)
 if (plan.some(row => row.input.assigneeId !== context.userId)) throw new Error('Tasks must remain assigned to you. Review the selection again.')
 return plan
}
async function request(id: string, context: FollowUpContext, method: 'GET' | 'POST', body: unknown, signal?: AbortSignal, requestId?: string) {
 const controller = new AbortController(), abort = () => controller.abort(), timer = setTimeout(abort, 25000)
 if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true })
 try {
  const response = await fetch(`/api/follow-ups/${encodeURIComponent(id)}/approval${requestId ? `?requestId=${encodeURIComponent(requestId)}` : ''}`, { method, cache: 'no-store', headers: { ...followUpHeaders(context), ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}), signal: controller.signal })
  const result = await followUpData(response, context)
  if (result.canWrite !== true) throw new FollowUpClientError('Editing access changed. Reload before continuing.', 403, 'FORBIDDEN')
  return result.data
 } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
}
export async function previewBulkApproval(raw: unknown, context: FollowUpContext, hooks: Pick<Hooks, 'active' | 'signal' | 'onAccessLost'>) {
 const selected = selection.parse(raw), rows: z.infer<typeof approvalPreview>[] = []
 for (const id of selected) {
  if (!hooks.active()) return []
  try {
   const row = approvalPreview.parse(await request(id, context, 'GET', undefined, hooks.signal))
   if (!hooks.active()) return []
   if (row.id !== id || row.assigneeId !== context.userId) throw new Error('This review could not be confirmed. Refresh and review again.')
   rows.push(row)
  } catch (cause) { if (hooks.active() && followUpAccessLost(cause)) hooks.onAccessLost?.(cause, id); throw cause }
 }
 return rows
}
const outcome = (cause: unknown, id: string, hooks: Hooks): BulkApprovalOutcome => {
 if (followUpAccessLost(cause)) hooks.onAccessLost?.(cause, id)
 const definite = cause instanceof FollowUpClientError && cause.status >= 400 && cause.status < 500
 return { id, state: definite ? 'failed' : 'unconfirmed', message: definite ? cause.message : 'Approval could not be confirmed. Check results before trying again.' }
}
function checkedReceipt(raw: unknown, row: BulkApprovalPlan[number]) {
 const receipt = approvalReceipt.parse(raw)
 if (receipt.id !== row.id || receipt.requestId !== row.input.requestId || receipt.state === 'confirmed' && !sameApprovalTask(receipt.task, row.input)) throw new Error('Unexpected approval receipt.')
 return receipt
}
export async function runBulkApproval(raw: unknown, context: FollowUpContext, hooks: Hooks) {
 const plan = makeBulkApprovalPlan(raw, context), results: BulkApprovalOutcome[] = plan.map(row => ({ id: row.id, state: 'not-attempted', message: 'Not attempted.' }))
 for (const [index, row] of plan.entries()) {
  if (!hooks.active()) break
  if (hooks.isCurrent && !hooks.isCurrent(row)) { results[index] = { id: row.id, state: 'failed', message: 'The selected follow-up changed. Review again.' }; hooks.onProgress?.([...results]); break }
  try {
   const receipt = checkedReceipt(await request(row.id, context, 'POST', row.input, hooks.signal), row)
   if (!hooks.active()) break
   if (receipt.state !== 'confirmed') throw new Error('Approval not confirmed')
   hooks.onChanged(receipt); results[index] = { id: row.id, state: 'approved', message: 'Task approval confirmed.' }
  } catch (cause) { if (!hooks.active()) break; results[index] = outcome(cause, row.id, hooks); if (hooks.active()) hooks.onProgress?.([...results]); break }
  if (hooks.active()) hooks.onProgress?.([...results])
 }
 return results
}
export async function verifyBulkApproval(raw: unknown, previous: BulkApprovalOutcome[], context: FollowUpContext, hooks: Hooks) {
 const plan = makeBulkApprovalPlan(raw, context), results = previous.map(row => ({ ...row }))
 if (results.length !== plan.length || results.some((row, i) => row.id !== plan[i].id)) throw new Error('The reviewed batch changed.')
 for (const [index, row] of plan.entries()) {
  if (!hooks.active()) break
  if (!['unconfirmed', 'failed'].includes(results[index].state)) continue
  try {
   const receipt = checkedReceipt(await request(row.id, context, 'GET', undefined, hooks.signal, row.input.requestId), row)
   if (!hooks.active()) break
   if (receipt.state === 'confirmed') { hooks.onChanged(receipt); results[index] = { id: row.id, state: 'verified', message: 'Requested task approval verified.' } }
   else results[index] = { id: row.id, state: 'not-recorded', message: receipt.state === 'changed' ? 'The approved task changed. Review it in CRM before another attempt.' : 'No matching confirmation found. Refresh and review before another attempt.' }
  } catch (cause) { if (!hooks.active()) break; results[index] = outcome(cause, row.id, hooks); if (hooks.active()) hooks.onProgress?.([...results]); break }
  if (hooks.active()) hooks.onProgress?.([...results])
 }
 return results
}
