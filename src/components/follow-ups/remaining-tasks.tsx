'use client'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { FollowUpContext } from '@/lib/follow-up-access'
import { followUpAccessLost } from '@/lib/follow-up-client'
import type { TaskBatchDetail } from '@/lib/follow-up-task-batches'
import type { RemainingTaskReview } from '@/lib/follow-up-remaining-tasks'
import { fetchRemainingTaskReview } from '@/lib/follow-up-remaining-client'
import { saveTaskBatchIntent, taskBatchChanged } from '@/lib/follow-up-task-batch-client'
import { makeBulkTaskCompletionPlan, runBulkTaskCompletion, verifyBulkTaskCompletion, type BulkTaskCompletionPlan, type BulkTaskCompletionOutcome } from '@/lib/follow-up-bulk-task-completion'
import { makeBulkTaskReschedulePlan, runBulkTaskReschedule, verifyBulkTaskReschedule, type BulkTaskReschedulePlan, type BulkTaskRescheduleOutcome } from '@/lib/follow-up-bulk-task-reschedule'
import type { TaskCompletionReceipt } from '@/lib/follow-up-task-completion'
import type { TaskRescheduleReceipt } from '@/lib/follow-up-task-reschedule'
export type RemainingTaskControls = { disabled: boolean; onBusyChange: (busy: boolean) => void; onCompleted: (receipt: Extract<TaskCompletionReceipt, {state:'confirmed'}>) => void; onRescheduled: (receipt: Extract<TaskRescheduleReceipt, {state:'confirmed'}>) => void }
type Props = RemainingTaskControls & { detail: TaskBatchDetail; context: FollowUpContext; onAccessLost: (cause: unknown) => void }
type Run = { kind: 'COMPLETE'; plan: BulkTaskCompletionPlan; results: BulkTaskCompletionOutcome[] } | { kind: 'RESCHEDULE'; plan: BulkTaskReschedulePlan; results: BulkTaskRescheduleOutcome[] }
const field = 'min-h-11 w-full min-w-0 rounded border bg-background p-2 text-sm'
export function RemainingTasks(props: Props) {
 const [selected, setSelected] = useState<number[]>([]), [localTime, setLocalTime] = useState(''), [timeZone, setTimeZone] = useState(''), [review, setReview] = useState<RemainingTaskReview | null>(null), [run, setRun] = useState<Run | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
 const latest = useRef(props), live = useRef(true), writing = useRef(false), generation = useRef(0), controller = useRef<AbortController | null>(null)
 latest.current = props
 useEffect(() => { try { setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) } catch { /* Explicit timezone entry stays available. */ } }, [])
 useEffect(() => { const life = live, counter = generation, pending = controller, current = latest, owned = writing; life.current = true; return () => { life.current = false; counter.current++; pending.current?.abort(); if (owned.current) { owned.current = false; current.current.onBusyChange(false) } } }, [])
 useEffect(() => { if (!writing.current && !run) { setReview(null); setError(''); generation.current++ } }, [props.detail, run])
 const eligible = props.detail.items.filter(row => row.state !== 'unavailable' && ['failed','not-attempted'].includes(row.state) && !row.task.isComplete)
 const disabled = props.disabled || busy
 const visible = (index: number, taskId: string) => { const row = props.detail.items.find(row => row.index === index); return props.detail.canReview && row && row.state !== 'unavailable' && row.task.id === taskId }
 const stale = review?.items.some(row => !visible(row.index, row.preview.task.id) || !eligible.some(item => item.index === row.index))
 function edit(indices = selected, time = localTime, zone = timeZone) { if (disabled || run) return; generation.current++; setSelected(indices); setLocalTime(time); setTimeZone(zone); setReview(null); setError('') }
 async function execute(kind: 'review' | 'confirm' | 'check') {
  if (disabled || writing.current || !props.detail.canReview || kind === 'review' && (!selected.length || run) || kind === 'confirm' && (!review?.items.length || stale || run) || kind === 'check' && !run) return
  writing.current = true; setBusy(true); props.onBusyChange(true); setError('')
  const current = ++generation.current, request = new AbortController(), scope = JSON.stringify([props.context.organizationId, props.context.userId, props.detail.id]); controller.current = request
  const active = () => live.current && generation.current === current && !request.signal.aborted && !latest.current.disabled && latest.current.detail.canReview === true && JSON.stringify([latest.current.context.organizationId, latest.current.context.userId, latest.current.detail.id]) === scope
  const shared = { active, signal: request.signal, onAccessLost: (cause: unknown) => { if (active()) latest.current.onAccessLost(cause) } }
  try {
   if (kind === 'review') {
    setReview(null)
    const result = await fetchRemainingTaskReview(props.detail, { indices: selected, ...(props.detail.kind === 'RESCHEDULE' ? { target: { localTime, timeZone } } : {}) }, props.context, shared)
    if (active()) setReview(result)
    return
   }
   let frozen: Run
   if (kind === 'check') frozen = run!
   else if (review!.kind === 'COMPLETE') {
    const plan = makeBulkTaskCompletionPlan(review!.items.map(row => ({ id: row.preview.id, listKey: String(row.index), input: { requestId: crypto.randomUUID(), expectedVersion: row.preview.version, taskId: row.preview.task.id } })))
    frozen = { kind: 'COMPLETE', plan, results: plan.map(row => ({ id: row.id, state: 'not-attempted', message: 'Not attempted.' })) }
   } else {
    const plan = makeBulkTaskReschedulePlan(review!.items.map(row => ({ id: row.preview.id, listKey: String(row.index), previousDueDate: row.preview.task.dueDate, dueDate: row.preview.newDueDate, input: { requestId: crypto.randomUUID(), expectedVersion: row.preview.version, taskId: row.preview.task.id, localTime: row.preview.localTime, timeZone: row.preview.timeZone } })))
    frozen = { kind: 'RESCHEDULE', plan, results: plan.map(row => ({ id: row.id, state: 'not-attempted', message: 'Not attempted.' })) }
   }
   setRun(frozen)
   let batchId: string | undefined
   if (kind === 'confirm') {
    const items = frozen.kind === 'COMPLETE' ? frozen.plan.map(({id,input}) => ({id,input})) : frozen.plan.map(({id,input,previousDueDate,dueDate}) => ({id,input,previousDueDate,dueDate}))
    batchId = await saveTaskBatchIntent({ id: crypto.randomUUID(), kind: frozen.kind, items }, props.context, shared)
    if (!active()) return
   }
   const isCurrent = (row: {listKey:string;input:{taskId:string}}) => { const item = latest.current.detail.items.find(item => item.index === Number(row.listKey)); return Boolean(item && item.state !== 'unavailable' && ['failed','not-attempted'].includes(item.state) && !item.task.isComplete && item.task.id === row.input.taskId) }
   if (frozen.kind === 'COMPLETE') {
    const currentRun = frozen
    const hooks = { ...shared, batchId, isCurrent, onChanged: (receipt: Extract<TaskCompletionReceipt,{state:'confirmed'}>) => { if (active()) latest.current.onCompleted(receipt) }, onProgress: (results: BulkTaskCompletionOutcome[]) => { if (active()) setRun({ ...currentRun, results }) } }
    const results = kind === 'check' ? await verifyBulkTaskCompletion(frozen.plan, frozen.results, props.context, hooks) : await runBulkTaskCompletion(frozen.plan, props.context, hooks)
    if (active()) setRun({ ...frozen, results })
   } else {
    const currentRun = frozen
    const hooks = { ...shared, batchId, isCurrent, onChanged: (receipt: Extract<TaskRescheduleReceipt,{state:'confirmed'}>) => { if (active()) latest.current.onRescheduled(receipt) }, onProgress: (results: BulkTaskRescheduleOutcome[]) => { if (active()) setRun({ ...currentRun, results }) } }
    const results = kind === 'check' ? await verifyBulkTaskReschedule(frozen.plan, frozen.results, props.context, hooks) : await runBulkTaskReschedule(frozen.plan, props.context, hooks)
    if (active()) setRun({ ...frozen, results })
   }
   taskBatchChanged()
  } catch (cause) { if (active()) { setError(cause instanceof Error ? cause.message : 'Check saved history and review again.'); if (followUpAccessLost(cause)) { setReview(null); latest.current.onAccessLost(cause) } } }
  finally { if (live.current && generation.current === current) { writing.current = false; controller.current = null; setBusy(false); latest.current.onBusyChange(false) } }
 }
 if (!props.detail.canReview) return null
 const confirmed = run?.results.filter(row => ['completed','rescheduled','verified'].includes(row.state)).length ?? 0
 const reasons = { confirmed:'Already confirmed; excluded.', uncertain:'Still uncertain; excluded.', unavailable:'Unavailable task; excluded.', completed:'Already completed; excluded.', changed:'Task changed or deadline is unchanged; excluded.' }
 return <section aria-label="Review remaining tasks" aria-busy={busy} className="min-w-0 space-y-3 border-t pt-3">
  <h3 className="font-medium">Review remaining tasks</h3><p>Choose failed or unattempted open tasks for a new review. Check saved results first: successful and still-uncertain requests are excluded. This creates a separate batch only after confirmation.</p>
  <Button type="button" variant="outline" disabled={disabled || Boolean(run) || !eligible.length} onClick={() => edit(eligible.map(row => row.index))}>Select remaining open tasks</Button>
  <div className="space-y-2">{eligible.map(row => row.state !== 'unavailable' && <label key={row.index} className="flex min-h-11 items-center gap-2"><input type="checkbox" aria-label={'Select remaining task '+row.task.title} checked={selected.includes(row.index)} disabled={disabled || Boolean(run)} onChange={event => edit(event.target.checked ? [...selected,row.index] : selected.filter(index => index !== row.index))}/><span className="break-words">{row.task.title}</span></label>)}</div>
  {!eligible.length && <p>No failed or unattempted open tasks are available. Uncertain requests need a definitive result before another attempt.</p>}
  {props.detail.kind === 'RESCHEDULE' && <div className="grid gap-2"><label>Remaining tasks new deadline<input type="datetime-local" className={field} value={localTime} disabled={disabled || Boolean(run)} onChange={event => edit(selected,event.target.value)}/></label><label>Remaining tasks timezone<input className={field} value={timeZone} maxLength={100} disabled={disabled || Boolean(run)} onChange={event => edit(selected,localTime,event.target.value)}/></label><p>Choose a new future deadline and IANA timezone. Original callback appointments stay separate.</p></div>}
  <div className="flex flex-wrap gap-2"><Button type="button" disabled={disabled || !selected.length || Boolean(run)} onClick={() => void execute('review')}>Review remaining tasks</Button><Button type="button" variant="outline" disabled={disabled} onClick={() => { generation.current++; setReview(null); setRun(null); setSelected([]); setError('') }}>Clear remaining review</Button></div>
  {busy && <p role="status">Checking or confirming remaining tasks…</p>}
  {review && !run && <div role="group" aria-label="Remaining task review" className="space-y-3">
   <p>Review these current tasks. No task has changed yet. Confirm to {review.kind === 'COMPLETE' ? 'complete them' : 'save the new deadlines'}; processing stops at the first failure.</p>
   {review.items.map(row => <div key={row.index} className="space-y-1 rounded border p-3">{visible(row.index,row.preview.task.id) ? <><p className="break-words font-medium">{row.preview.task.title}</p><p className="break-words">{row.preview.leadName} · Assigned to {row.preview.task.assigneeName}</p><p className="whitespace-pre-wrap break-words">{row.preview.task.description}</p><p>Current deadline <time dateTime={row.preview.task.dueDate}>{new Date(row.preview.task.dueDate).toLocaleString()}</time></p>{'newDueDate' in row.preview && <p>New deadline <time dateTime={row.preview.newDueDate}>{new Date(row.preview.newDueDate).toLocaleString()}</time> ({row.preview.localTime} {row.preview.timeZone})</p>}</> : <p>Unavailable task</p>}</div>)}
   {review.skipped.map(row => <p key={row.index}>{reasons[row.reason]}</p>)}
   {stale && <p role="alert">Selected tasks changed. Check history and review again.</p>}
   <Button type="button" disabled={disabled || stale || !review.items.length} onClick={() => void execute('confirm')}>{review.kind === 'COMPLETE' ? 'Confirm remaining task completions' : 'Confirm remaining deadline changes'}</Button>
  </div>}
  {run && <div className="space-y-2"><p role="status">{confirmed} of {run.results.length} remaining task changes confirmed or verified.</p><ul aria-label="Remaining task results">{run.results.map(row => { const entry = run.plan.find(item => item.id === row.id)!, current = props.detail.items.find(item => item.index === Number(entry.listKey)); return <li key={row.id} className="break-words">{current && current.state !== 'unavailable' && current.task.id === entry.input.taskId ? current.task.title : 'Unavailable task'} — {row.message}</li> })}</ul><p>Saved history keeps the new batch. Checks only read exact attempted requests; they never repeat or continue changes.</p>{run.results.some(row => ['failed','unconfirmed'].includes(row.state)) && <Button type="button" variant="outline" disabled={disabled} onClick={() => void execute('check')}>Check remaining results</Button>}</div>}
  {error && <p role="alert" className="text-destructive">{error}</p>}
 </section>
}
