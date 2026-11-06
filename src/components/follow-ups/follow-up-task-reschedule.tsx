'use client'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { followUpHeaders, type FollowUpContext } from '@/lib/follow-up-access'
import { followUpAccessLost, followUpData, FollowUpClientError } from '@/lib/follow-up-client'
import type { TaskProgress } from '@/lib/follow-up-task-progress'
import { taskRescheduleInput, taskReschedulePreview, taskRescheduleReceipt, type TaskRescheduleInput, type TaskReschedulePreview, type TaskRescheduleReceipt } from '@/lib/follow-up-task-reschedule'
type Confirmed = Extract<TaskRescheduleReceipt, { state: 'confirmed' }>
export type RescheduleHold = 'editing' | 'pending' | false
type Props = { id: string; taskId: string | null; progress?: TaskProgress; context: FollowUpContext; canWrite: boolean; disabled: boolean; onChanged: (value: Confirmed) => void; onBusyChange: (busy: boolean) => void; onHoldChange: (id: string, hold: RescheduleHold) => void; onAccessLost: (cause: unknown, id: string) => void }
type Plan = { input: TaskRescheduleInput; dueDate: string; previousDueDate: string }
const keyFor = (p: Props) => JSON.stringify([p.id, p.taskId, p.context.organizationId, p.context.userId, p.progress?.state, p.progress && p.progress.state !== 'UNAVAILABLE' ? p.progress.dueDate : null])
export function FollowUpTaskReschedule(props: Props) {
 const [zone, setZone] = useState(''), [localTime, setLocalTime] = useState(''), [open, setOpen] = useState(false), [review, setReview] = useState<TaskReschedulePreview | null>(null), [plan, setPlan] = useState<Plan | null>(null)
 const [busy, setBusy] = useState(false), [lost, setLost] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
 const latest = useRef(props), live = useRef(true), writing = useRef(false), generation = useRef(0), controller = useRef<AbortController | null>(null), held = useRef<RescheduleHold>(false), reviewKey = useRef('')
 latest.current = props
 const available = Boolean(props.taskId && props.progress && ['OPEN', 'OVERDUE'].includes(props.progress.state)), key = keyFor(props)
 useEffect(() => { try { const detected = Intl.DateTimeFormat().resolvedOptions().timeZone; new Intl.DateTimeFormat('en', { timeZone: detected }).format(); setZone(detected) } catch { setError('Your timezone could not be detected. Reload before choosing a deadline.') } }, [])
 useEffect(() => { const life = live, counter = generation, request = controller, running = writing, current = latest, hold = held, id = props.id; life.current = true; return () => { life.current = false; counter.current++; request.current?.abort(); if (running.current) current.current.onBusyChange(false); if (hold.current) current.current.onHoldChange(id, false) } }, [props.id])
 useEffect(() => {
  if (!props.canWrite || props.progress?.state === 'UNAVAILABLE') {
   generation.current++; controller.current?.abort(); setOpen(false); setReview(null); setPlan(null); setLocalTime(''); setError(''); setNotice('')
   if (held.current) { held.current = false; latest.current.onHoldChange(props.id, false) }
   if (writing.current) { writing.current = false; setBusy(false); latest.current.onBusyChange(false) }
  } else if (review && reviewKey.current !== key && !writing.current) { setReview(null); setError('The task changed. Review the deadline again before confirming.') }
 }, [props.id, props.canWrite, props.progress?.state, key, review])
 function hold(value: RescheduleHold) { held.current = value; latest.current.onHoldChange(props.id, value) }
 function cancel() { if (busy || plan || props.disabled) return; setOpen(false); setReview(null); setError(''); hold(false) }
 async function execute(kind: 'review' | 'confirm' | 'check') {
  if (writing.current || props.disabled || !props.canWrite || lost || !props.taskId || kind !== 'check' && (!available || !zone || !localTime || plan) || kind === 'confirm' && (!review || reviewKey.current !== key) || kind === 'check' && !plan) return
  writing.current = true; setBusy(true); props.onBusyChange(true); setError(''); setNotice('')
  const current = ++generation.current, request = new AbortController(), startKey = key; controller.current = request
  const active = () => live.current && generation.current === current && !request.signal.aborted && latest.current.canWrite && keyFor(latest.current) === startKey
  const read = async (url: string, init?: RequestInit) => {
   const value = await followUpData<unknown>(await fetch(url, { ...init, cache: 'no-store', signal: request.signal, headers: { ...followUpHeaders(props.context), ...(init?.headers ?? {}) } }), props.context)
   if (value.canWrite !== true) throw new FollowUpClientError('Editing access changed. Reload before continuing.', 409, 'FOLLOW_UP_CONTEXT_CHANGED')
   return value.data
  }
  const endpoint = '/api/follow-ups/' + encodeURIComponent(props.id) + '/task-reschedule'
  let submitted = false
  try {
   if (kind === 'review') {
    const q = new URLSearchParams({ localTime, timeZone: zone }), parsed = taskReschedulePreview.safeParse(await read(endpoint + '?' + q))
    if (!active()) return
    if (!parsed.success || parsed.data.id !== props.id || parsed.data.task.id !== props.taskId || parsed.data.localTime !== localTime || parsed.data.timeZone !== zone) throw new Error('The deadline review could not be verified. Review again.')
    reviewKey.current = startKey; setReview(parsed.data)
   } else {
    const frozen: Plan = kind === 'check' ? plan! : { input: taskRescheduleInput.parse({ requestId: crypto.randomUUID(), expectedVersion: review!.version, taskId: review!.task.id, localTime: review!.localTime, timeZone: review!.timeZone }), dueDate: review!.newDueDate, previousDueDate: review!.task.dueDate }
    if (kind === 'confirm') { hold('pending'); setPlan(frozen); submitted = true }
    const raw = kind === 'check' ? await read(endpoint + '?requestId=' + frozen.input.requestId) : await read(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(frozen.input) })
    if (!active()) return
    const parsed = taskRescheduleReceipt.safeParse(raw)
    if (!parsed.success || parsed.data.id !== props.id || parsed.data.requestId !== frozen.input.requestId || parsed.data.state === 'confirmed' && (parsed.data.task.id !== frozen.input.taskId || parsed.data.task.dueDate !== frozen.dueDate || parsed.data.task.previousDueDate !== frozen.previousDueDate)) throw new Error('The rescheduling receipt could not be verified.')
    setReview(null); setPlan(null); setOpen(false); hold(false)
    if (parsed.data.state === 'confirmed') { setNotice('Task deadline change confirmed.'); latest.current.onChanged(parsed.data) }
    else setNotice(parsed.data.state === 'not-recorded' ? 'No deadline change was recorded for this request. Review again before confirming.' : 'The task changed after this request. Refresh and review it again.')
   }
  } catch (cause) {
   if (!active()) return
   if (followUpAccessLost(cause)) { setLost(true); setReview(null); setPlan(null); setOpen(false); setLocalTime(''); hold(false); latest.current.onAccessLost(cause, props.id); return }
   if (cause instanceof FollowUpClientError && [400, 409].includes(cause.status)) { setReview(null); setPlan(null); hold('editing'); setError(cause.message) }
   else if (submitted || kind === 'check') { setReview(null); setError('Rescheduling is not confirmed. Check the exact result before taking another action.') }
   else setError(cause instanceof Error ? cause.message : 'Unable to review the new deadline.')
  } finally { if (live.current && generation.current === current) { writing.current = false; controller.current = null; setBusy(false); latest.current.onBusyChange(false) } }
 }
 if (!props.canWrite || props.progress?.state === 'UNAVAILABLE' || lost || !props.taskId || !available && !open && !plan && !notice) return null
 const format = (at: string, timeZone: string) => new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(at))
 return <section aria-label="Task rescheduling" aria-busy={busy} className="mt-4 space-y-3 rounded-lg border p-3">
  {!open && available && <Button type="button" variant="outline" disabled={busy || props.disabled} onClick={() => { setOpen(true); setError(''); setNotice(''); hold('editing') }}>Reschedule task</Button>}
  {open && !review && !plan && <div role="group" aria-label="Choose task deadline" className="space-y-2 text-sm">
   <p>Timezone: {zone || 'Detecting timezone…'}</p><label className="grid gap-1">New deadline<input aria-label="New deadline" type="datetime-local" className="min-h-11 w-full min-w-0 rounded-md border bg-background p-2" value={localTime} disabled={busy || props.disabled || !available} onChange={event => setLocalTime(event.target.value)} /></label>
   {!available && <p>The task is no longer open. Close this deadline editor to continue.</p>}
   <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy || props.disabled || !zone || !localTime || !available} onClick={() => void execute('review')}>Review new deadline</Button><Button type="button" variant="outline" disabled={busy || props.disabled} onClick={cancel}>Cancel rescheduling</Button></div>
  </div>}
  {review && !plan && <div role="group" aria-label="Task deadline review" className="space-y-2 break-words text-sm">
   <p className="font-medium">Confirm this task deadline change?</p><p>{review.task.title}</p><p>Lead: {review.leadName}</p><p>Assigned to: {review.task.assigneeName || 'Team member'}</p><p className="whitespace-pre-wrap">{review.task.description || 'No task description.'}</p>
   <p>Timezone: {review.timeZone}</p><p>Old deadline: <time dateTime={review.task.dueDate}>{format(review.task.dueDate, review.timeZone)}</time></p><p>New deadline: <time dateTime={review.newDueDate}>{format(review.newDueDate, review.timeZone)}</time></p>
   <p className="text-xs text-muted-foreground">This changes the CRM task deadline and records an activity. Callback appointments, outcomes, and email approvals stay separate. No email is sent.</p>
   <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy || props.disabled || !available || reviewKey.current !== key} onClick={() => void execute('confirm')}>Confirm rescheduling</Button><Button type="button" variant="outline" disabled={busy || props.disabled} onClick={() => setReview(null)}>Change deadline</Button><Button type="button" variant="outline" disabled={busy || props.disabled} onClick={cancel}>Cancel rescheduling</Button></div>
  </div>}
  {busy && <p role="status" className="text-sm">Checking task rescheduling…</p>}
  {plan && <><p className="text-xs text-muted-foreground">Checking only reads this exact request. It never repeats the deadline change.</p><Button type="button" variant="outline" disabled={busy || props.disabled} onClick={() => void execute('check')}>Check rescheduling result</Button></>}
  {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{notice && <p role="status" className="text-sm">{notice}</p>}
 </section>
}
