'use client'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { followUpHeaders, type FollowUpContext } from '@/lib/follow-up-access'
import { followUpAccessLost, followUpData, FollowUpClientError } from '@/lib/follow-up-client'
import { taskCompletionInput, taskCompletionPreview, taskCompletionReceipt, type TaskCompletionInput, type TaskCompletionPreview, type TaskCompletionReceipt } from '@/lib/follow-up-task-completion'
import type { TaskProgress } from '@/lib/follow-up-task-progress'

type Confirmed = Extract<TaskCompletionReceipt, { state: 'confirmed' }>
type Props = { id: string; taskId: string | null; progress?: TaskProgress; context: FollowUpContext; canWrite: boolean; disabled: boolean; onChanged: (receipt: Confirmed) => void; onBusyChange: (busy: boolean) => void; onPendingChange?: (id: string, pending: boolean) => void; onWorkChange?: (work: boolean) => void; onAccessLost: (cause: unknown, id: string) => void }
export function FollowUpTaskCompletion(props: Props) {
 const [review, setReview] = useState<TaskCompletionPreview | null>(null), [plan, setPlan] = useState<TaskCompletionInput | null>(null)
 const [busy, setBusy] = useState(false), [done, setDone] = useState(false), [lost, setLost] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
 const latest = useRef(props), live = useRef(true), writing = useRef(false), generation = useRef(0), controller = useRef<AbortController | null>(null), reviewKey = useRef(''), pending = useRef(false)
 latest.current = props
 const keyFor = (p: Props) => JSON.stringify([p.context.organizationId, p.context.userId, p.id, p.taskId, p.progress?.state, p.progress && p.progress.state !== 'UNAVAILABLE' ? p.progress.dueDate : null])
 const key = keyFor(props), available = Boolean(props.taskId && props.progress && ['OPEN', 'OVERDUE'].includes(props.progress.state))
 const work = Boolean(review && !plan), onWorkChange = props.onWorkChange
 useEffect(() => { onWorkChange?.(work); return () => onWorkChange?.(false) }, [work, onWorkChange])
 useEffect(() => { const life = live, counter = generation, request = controller, running = writing, current = latest, unresolved = pending, id = props.id; life.current = true; return () => { life.current = false; counter.current++; request.current?.abort(); if (running.current) current.current.onBusyChange(false); if (unresolved.current) current.current.onPendingChange?.(id, false) } }, [props.id])
 useEffect(() => {
  if (!props.canWrite || props.progress?.state === 'UNAVAILABLE') {
   generation.current++; controller.current?.abort(); setReview(null); setPlan(null); setError(''); setNotice(''); setDone(false)
   if (pending.current) { pending.current = false; latest.current.onPendingChange?.(props.id, false) }
   if (writing.current) { writing.current = false; setBusy(false); latest.current.onBusyChange(false) }
  } else if (review && reviewKey.current !== key && !writing.current) { setReview(null); setError('Task progress changed. Review again before completing.') }
 }, [props.id, props.canWrite, props.progress?.state, key, review])
 function retainPending(value: boolean) { pending.current = value; latest.current.onPendingChange?.(props.id, value) }

 async function execute(kind: 'review' | 'confirm' | 'check') {
  if (writing.current || props.disabled || !props.canWrite || lost || !props.taskId || kind === 'review' && (!available || plan) || kind === 'confirm' && (!review || reviewKey.current !== key || plan) || kind === 'check' && !plan) return
  writing.current = true; setBusy(true); props.onBusyChange(true); setError(''); setNotice('')
  const current = ++generation.current, request = new AbortController(), startKey = key
  controller.current = request
  const active = () => live.current && current === generation.current && !request.signal.aborted && latest.current.canWrite && keyFor(latest.current) === startKey
  const read = async (url: string, init?: RequestInit) => {
   const value = await followUpData<unknown>(await fetch(url, { ...init, cache: 'no-store', signal: request.signal, headers: { ...followUpHeaders(props.context), ...(init?.headers ?? {}) } }), props.context)
   if (value.canWrite !== true) throw new FollowUpClientError('Current editing access changed. Reload before continuing.', 409, 'FOLLOW_UP_CONTEXT_CHANGED')
   return value.data
  }
  const endpoint = '/api/follow-ups/' + encodeURIComponent(props.id) + '/task-completion'
  let submitted = false
  try {
   if (kind === 'review') {
    setReview(null); setDone(false)
    const parsed = taskCompletionPreview.safeParse(await read(endpoint))
    if (!active()) return
    if (!parsed.success || parsed.data.id !== props.id || parsed.data.task.id !== props.taskId) throw new Error('The task review could not be verified. Refresh and review again.')
    reviewKey.current = startKey; setReview(parsed.data)
   } else {
    const input = kind === 'check' ? plan! : taskCompletionInput.parse({ requestId: crypto.randomUUID(), expectedVersion: review!.version, taskId: review!.task.id })
    if (kind === 'confirm') { retainPending(true); setPlan(input); submitted = true }
    const raw = kind === 'check' ? await read(endpoint + '?requestId=' + input.requestId) : await read(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
    if (!active()) return
    const parsed = taskCompletionReceipt.safeParse(raw)
    if (!parsed.success || parsed.data.id !== props.id || parsed.data.requestId !== input.requestId || parsed.data.state === 'confirmed' && parsed.data.task.id !== input.taskId) throw new Error('The completion receipt could not be verified.')
    const result = parsed.data
    setReview(null); setPlan(null); retainPending(false)
    if (result.state === 'confirmed') { setDone(true); latest.current.onChanged(result) }
    else setNotice(result.state === 'not-recorded' ? 'No completion was recorded for this request. Review the task again before confirming.' : 'The task changed after this request. Refresh and review it again.')
   }
  } catch (cause) {
   if (!active()) return
   if (followUpAccessLost(cause)) { setLost(true); setReview(null); setPlan(null); setDone(false); retainPending(false); latest.current.onAccessLost(cause, props.id); return }
   if (cause instanceof FollowUpClientError && cause.status === 409) { setReview(null); setPlan(null); retainPending(false); setError(cause.message) }
   else if (submitted || kind === 'check') { setReview(null); setError('Completion is not confirmed. Check the result before taking another action.') }
   else setError(cause instanceof Error ? cause.message : 'Unable to review this task. Try again.')
  } finally {
   if (live.current && generation.current === current) { writing.current = false; controller.current = null; setBusy(false); latest.current.onBusyChange(false) }
  }
 }
 if (!props.canWrite || props.progress?.state === 'UNAVAILABLE' || lost || !props.taskId) return null
 if (!available && !plan && !done && !error && !notice) return null
 return <section aria-label="Task completion" aria-busy={busy} className="mt-4 space-y-3 rounded-lg border p-3">
  {done ? <><p role="status" className="text-sm font-medium">Task completion confirmed.</p><p className="text-xs text-muted-foreground">Your filters and unsent drafts are kept. Refresh the list when you are ready to reapply its filters.</p></> : <>
   {!plan && !review && available && <Button type="button" variant="outline" disabled={busy || props.disabled} onClick={() => void execute('review')}>Review task completion</Button>}
   {busy && <p role="status" className="text-sm">{plan ? 'Checking task completion…' : 'Loading task review…'}</p>}
   {review && !plan && <div role="group" aria-label="Task completion review" className="space-y-2 text-sm">
    <p className="font-medium">Complete this CRM task?</p><p className="break-words">{review.task.title}</p><p className="break-words">Lead: {review.leadName}</p><p className="break-words">Assigned to: {review.task.assigneeName || 'Team member'}{review.task.assigneeId === props.context.userId ? ' (you)' : ''}</p><p className="whitespace-pre-wrap break-words">{review.task.description || 'No task description.'}</p>
    <p>Due <time dateTime={review.task.dueDate}>{new Date(review.task.dueDate).toLocaleString()}</time>. Dates use your browser timezone.</p>
    <p className="text-xs text-muted-foreground">This marks the linked task complete and records an activity on the lead. Callback outcomes and email approvals stay separate. No email is sent.</p>
    <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy || props.disabled || reviewKey.current !== key} onClick={() => void execute('confirm')}>Confirm task completion</Button><Button type="button" variant="outline" disabled={busy || props.disabled} onClick={() => { setReview(null); setError('') }}>Cancel completion</Button></div>
   </div>}
   {plan && <><p className="text-xs text-muted-foreground">Check only reads the result of this exact request. It does not repeat completion.</p><Button type="button" variant="outline" disabled={busy || props.disabled} onClick={() => void execute('check')}>Check completion result</Button></>}
  </>}
  {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  {notice && <p role="status" className="text-sm">{notice}</p>}
 </section>
}
