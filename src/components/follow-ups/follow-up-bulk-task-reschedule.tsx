'use client'
import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { FollowUpContext } from '@/lib/follow-up-access'
import type { TaskReschedulePreview, TaskRescheduleReceipt } from '@/lib/follow-up-task-reschedule'
import { BULK_TASK_RESCHEDULE_LIMIT, canBulkRescheduleTask, rescheduleListKey, uniqueRescheduleSelection, makeBulkTaskReschedulePlan, previewBulkTaskReschedule, runBulkTaskReschedule, verifyBulkTaskReschedule, type RescheduleItem, type BulkTaskReschedulePlan, type BulkTaskRescheduleOutcome } from '@/lib/follow-up-bulk-task-reschedule'

export type BulkRescheduleHold = 'editing' | 'review' | 'results' | false
type Confirmed = Extract<TaskRescheduleReceipt, { state: 'confirmed' }>
type Props = { items: RescheduleItem[]; selectedIds: string[]; blockedIds: string[]; context: FollowUpContext; disabled: boolean; otherBusy: boolean; refreshing: boolean; onSelectionChange: (ids: string[]) => void; onChanged: (receipt: Confirmed) => void; onAccessLost: (cause: unknown, id: string) => void; onBusyChange: (busy: boolean) => void; onHold: (ids: string[], stage: BulkRescheduleHold) => void }
type Review = TaskReschedulePreview & { listKey: string }
const field = 'min-h-11 w-full min-w-0 max-w-full rounded-md border bg-background p-2 text-sm disabled:opacity-60'
export function FollowUpBulkTaskReschedule(props: Props) {
 const [zone, setZone] = useState(''), [localTime, setLocalTime] = useState(''), [reviews, setReviews] = useState<Review[]>([]), [plan, setPlan] = useState<BulkTaskReschedulePlan | null>(null), [results, setResults] = useState<BulkTaskRescheduleOutcome[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('')
 const latest = useRef(props), live = useRef(true), writing = useRef(false), generation = useRef(0), controller = useRef<AbortController | null>(null), defaultZone = useRef(''), dirty = useRef(false), target = useRef({ localTime, timeZone: zone })
 const hint = useId(); latest.current = props; target.current = { localTime, timeZone: zone }
 const selectionKey = JSON.stringify(props.selectedIds), byId = new Map(props.items.map(row => [row.id, row])), blocked = new Set(props.blockedIds)
 useEffect(() => { try { const detected = Intl.DateTimeFormat().resolvedOptions().timeZone; new Intl.DateTimeFormat('en', { timeZone: detected }).format(); defaultZone.current = detected; setZone(detected) } catch { setError('Choose an IANA timezone before reviewing deadlines.') } }, [])
 useEffect(() => { const life = live, counter = generation, pending = controller, current = latest; life.current = true; return () => { life.current = false; counter.current++; pending.current?.abort(); current.current.onBusyChange(false); current.current.onHold([], false) } }, [])
 useEffect(() => { if (!writing.current) { setReviews([]); setPlan(null); setResults([]); setError(''); latest.current.onHold(latest.current.selectedIds, dirty.current ? 'editing' : false) } }, [selectionKey])
 const stale = reviews.some(row => { const item = byId.get(row.id); return !props.selectedIds.includes(row.id) || blocked.has(row.id) || !item || !canBulkRescheduleTask(item) || rescheduleListKey(item) !== row.listKey || row.localTime !== localTime || row.timeZone !== zone })
 const disabled = props.disabled || props.otherBusy || props.refreshing || busy
 function edit(nextTime: string, nextZone: string) {
  if (disabled || writing.current || results.length) return
  target.current = { localTime: nextTime, timeZone: nextZone }; dirty.current = Boolean(nextTime || nextZone !== defaultZone.current)
  setLocalTime(nextTime); setZone(nextZone); setReviews([]); setError(''); props.onHold(props.selectedIds, dirty.current ? 'editing' : false)
 }
 function clear() {
  if (disabled || writing.current) return
  dirty.current = false; target.current = { localTime: '', timeZone: defaultZone.current }; setLocalTime(''); setZone(defaultZone.current); setReviews([]); setPlan(null); setResults([]); setError(''); props.onHold([], false); props.onSelectionChange([])
 }
 async function execute(kind: 'review' | 'confirm' | 'check') {
  if (disabled || writing.current || kind === 'review' && (!localTime || !zone || results.length) || kind === 'confirm' && (stale || !reviews.length || results.length) || kind === 'check' && !plan) return
  writing.current = true; setBusy(true); props.onBusyChange(true); setError('')
  const current = ++generation.current, request = new AbortController(), scope = JSON.stringify([props.context.organizationId, props.context.userId]), chosen = { ...target.current }, targetKey = JSON.stringify(chosen); controller.current = request
  const active = () => live.current && generation.current === current && !request.signal.aborted && !latest.current.disabled && JSON.stringify([latest.current.context.organizationId, latest.current.context.userId]) === scope && JSON.stringify(target.current) === targetKey
  const hooks = { active, signal: request.signal, onChanged: (receipt: Confirmed) => { if (active()) latest.current.onChanged(receipt) }, onAccessLost: (cause: unknown, id: string) => { if (active()) latest.current.onAccessLost(cause, id) }, onProgress: (rows: BulkTaskRescheduleOutcome[]) => { if (active()) setResults(rows) }, isCurrent: (row: BulkTaskReschedulePlan[number]) => { const item = latest.current.items.find(item => item.id === row.id); return latest.current.selectedIds.includes(row.id) && !latest.current.blockedIds.includes(row.id) && Boolean(item && canBulkRescheduleTask(item) && item.taskId === row.input.taskId && rescheduleListKey(item) === row.listKey) } }
  try {
   if (kind === 'review') {
    const selected = props.selectedIds.map(id => byId.get(id))
    if (!selected.length || selected.some(row => !row || !canBulkRescheduleTask(row) || blocked.has(row.id))) throw new Error('Select available open tasks before reviewing deadlines.')
    const keys = new Map(selected.map(row => [row!.id, rescheduleListKey(row!)]))
    setReviews([]); setPlan(null); setResults([]); props.onHold(props.selectedIds, 'editing')
    const snapshots = await previewBulkTaskReschedule(props.selectedIds, chosen, props.context, hooks)
    if (!active()) return
    const rows = snapshots.map(row => ({ ...row, listKey: keys.get(row.id)! }))
    if (rows.some(row => { const item = latest.current.items.find(item => item.id === row.id); return !item || item.taskId !== row.task.id || rescheduleListKey(item) !== row.listKey || latest.current.blockedIds.includes(row.id) })) throw new Error('Selected tasks changed. Review the deadlines again before confirming.')
    setReviews(rows); latest.current.onHold(rows.map(row => row.id), 'review')
   } else {
    const frozen = kind === 'check' ? plan! : makeBulkTaskReschedulePlan(reviews.map(row => ({ id: row.id, listKey: row.listKey, previousDueDate: row.task.dueDate, dueDate: row.newDueDate, input: { requestId: crypto.randomUUID(), expectedVersion: row.version, taskId: row.task.id, localTime: row.localTime, timeZone: row.timeZone } })))
    if (kind === 'confirm') { setPlan(frozen); latest.current.onHold(frozen.map(row => row.id), 'results'); setResults(frozen.map(row => ({ id: row.id, state: 'not-attempted', message: 'Not attempted.' }))) }
    const next = kind === 'check' ? await verifyBulkTaskReschedule(frozen, results, props.context, hooks) : await runBulkTaskReschedule(frozen, props.context, hooks)
    if (active()) setResults(next)
   }
  } catch (cause) { if (active()) setError(cause instanceof Error ? cause.message : 'Deadline changes could not be confirmed. Review again.') }
  finally { if (live.current && generation.current === current) { writing.current = false; controller.current = null; setBusy(false); latest.current.onBusyChange(false) } }
 }
 const confirmed = results.filter(row => ['rescheduled', 'verified'].includes(row.state)).length, checking = results.some(row => ['unconfirmed', 'failed'].includes(row.state))
 const format = (at: string, timeZone: string) => new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(at))
 return <section aria-label="Bulk deadline rescheduling" aria-busy={busy} className="space-y-3 rounded-lg border bg-card p-4">
  <h2 className="text-sm font-medium">Bulk deadline rescheduling</h2><p className="text-sm">{props.selectedIds.length} selected · up to {BULK_TASK_RESCHEDULE_LIMIT} unique loaded tasks</p><p className="text-xs text-muted-foreground">Choose one deadline and timezone, review every old and new date, then confirm. Your filters, order and unsent drafts are kept. No email is sent.</p>
  <div className="grid min-w-0 gap-3 sm:grid-cols-2"><label className="grid min-w-0 gap-1 text-sm">Bulk new deadline<input aria-label="Bulk new deadline" type="datetime-local" className={field} value={localTime} disabled={disabled || results.length > 0} onChange={event => edit(event.target.value, zone)} /></label><label className="grid min-w-0 gap-1 text-sm">Bulk deadline timezone<input aria-label="Bulk deadline timezone" aria-describedby={hint} type="text" maxLength={100} className={field} value={zone} disabled={disabled || results.length > 0} onChange={event => edit(localTime, event.target.value)} /></label></div><p id={hint} className="text-xs text-muted-foreground">Use an IANA timezone, for example Asia/Manila or UTC. The review checks conversion and clock-change ambiguity. These are CRM task deadlines; callback appointments and outcomes stay separate.</p>
  <div className="flex flex-wrap gap-2"><Button className="min-h-11" type="button" variant="outline" disabled={disabled || reviews.length > 0 || results.length > 0} onClick={() => props.onSelectionChange(uniqueRescheduleSelection(props.items, props.blockedIds))}>Select up to 20 for rescheduling</Button><Button className="min-h-11" type="button" variant="outline" disabled={disabled || !props.selectedIds.length && !dirty.current && !reviews.length && !results.length} onClick={clear}>Clear bulk rescheduling</Button><Button className="min-h-11" type="button" disabled={disabled || !props.selectedIds.length || !localTime || !zone || results.length > 0} onClick={() => void execute('review')}>Review selected deadlines</Button></div>
  {busy && <p role="status" className="text-sm">{plan ? 'Checking or confirming task deadline changes…' : 'Loading selected deadline reviews…'}</p>}
  {reviews.length > 0 && results.length === 0 && <div role="group" aria-label="Bulk deadline review" className="space-y-3"><p className="text-sm">Confirm these CRM task deadline changes? Each change records an activity. Processing stops on the first failure. Changing the target requires a fresh review.</p>{reviews.map(row => { const item = byId.get(row.id), visible = item && canBulkRescheduleTask(item) && item.taskId === row.task.id; return <div key={row.id} className="min-w-0 space-y-1 rounded-md border p-3 text-sm">{visible ? <><p className="break-words font-medium">{row.task.title}</p><p className="break-words">Lead: {row.leadName}</p><p className="break-words">Assigned to: {row.task.assigneeName || 'Team member'}{row.task.assigneeId === props.context.userId ? ' (you)' : ''}</p><p className="whitespace-pre-wrap break-words">{row.task.description || 'No task description.'}</p><p className="break-words">Timezone: {row.timeZone}</p><p>Old deadline: <time dateTime={row.task.dueDate}>{format(row.task.dueDate, row.timeZone)}</time></p><p>New deadline: <time dateTime={row.newDueDate}>{format(row.newDueDate, row.timeZone)}</time></p></> : <p>Unavailable task</p>}</div> })}{stale && <p role="alert" className="text-sm text-destructive">Selected tasks changed. Review the deadlines again before confirming.</p>}<Button className="min-h-11" type="button" disabled={disabled || stale} onClick={() => void execute('confirm')}>Confirm bulk rescheduling</Button></div>}
  {results.length > 0 && <div className="space-y-2"><p role="status" className="text-sm">{confirmed} of {results.length} task deadline changes confirmed or verified.</p><ul aria-label="Task deadline results" className="space-y-2 text-sm">{results.map(row => { const item = byId.get(row.id), entry = plan?.find(value => value.id === row.id), visible = item && item.taskId === entry?.input.taskId && item.taskProgress && item.taskProgress.state !== 'UNAVAILABLE'; return <li key={row.id} className="break-words"><p>{visible ? `${item.lead?.firstName ?? ''} ${item.lead?.lastName ?? ''}: ${item.title ?? 'Task'}` : 'Unavailable task'} — {row.message}</p>{visible && entry && <p className="text-xs text-muted-foreground">Reviewed deadline: <time dateTime={entry.previousDueDate}>{format(entry.previousDueDate, entry.input.timeZone)}</time> → <time dateTime={entry.dueDate}>{format(entry.dueDate, entry.input.timeZone)}</time> ({entry.input.timeZone})</p>}</li> })}</ul><p className="text-xs text-muted-foreground">Saved deadline changes are kept. Clearing this selection loses its exact request checks. Clear and review remaining tasks before another attempt.</p>{checking && <><p className="text-xs text-muted-foreground">Check results only reads the exact attempted requests. It never repeats a deadline change or submits unattempted tasks.</p><Button className="min-h-11" type="button" variant="outline" disabled={disabled} onClick={() => void execute('check')}>Check deadline results</Button></>}</div>}
  {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
 </section>
}
