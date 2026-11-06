'use client'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { FollowUpContext } from '@/lib/follow-up-access'
import type { TaskCompletionPreview, TaskCompletionReceipt } from '@/lib/follow-up-task-completion'
import { BULK_TASK_COMPLETION_LIMIT, canBulkCompleteTask, completionListKey, uniqueCompletionSelection, makeBulkTaskCompletionPlan, previewBulkTaskCompletion, runBulkTaskCompletion, verifyBulkTaskCompletion, type CompletionItem, type BulkTaskCompletionPlan, type BulkTaskCompletionOutcome } from '@/lib/follow-up-bulk-task-completion'

type Confirmed = Extract<TaskCompletionReceipt, { state: 'confirmed' }>
type Props = { items: CompletionItem[]; selectedIds: string[]; blockedIds: string[]; context: FollowUpContext; disabled: boolean; otherBusy: boolean; refreshing: boolean; onSelectionChange: (ids: string[]) => void; onChanged: (receipt: Confirmed) => void; onAccessLost: (cause: unknown, id: string) => void; onBusyChange: (busy: boolean) => void; onHold: (ids: string[]) => void }
type Review = TaskCompletionPreview & { listKey: string }
export function FollowUpBulkTaskCompletion(props: Props) {
 const [reviews, setReviews] = useState<Review[]>([]), [plan, setPlan] = useState<BulkTaskCompletionPlan | null>(null), [results, setResults] = useState<BulkTaskCompletionOutcome[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('')
 const latest = useRef(props), live = useRef(true), writing = useRef(false), generation = useRef(0), controller = useRef<AbortController | null>(null)
 latest.current = props
 const selectionKey = JSON.stringify(props.selectedIds), byId = new Map(props.items.map(row => [row.id, row])), blocked = new Set(props.blockedIds)
 useEffect(() => { const life = live, counter = generation, pending = controller, current = latest; life.current = true; return () => { life.current = false; counter.current++; pending.current?.abort(); current.current.onBusyChange(false); current.current.onHold([]) } }, [])
 useEffect(() => { if (!writing.current) { setReviews([]); setPlan(null); setResults([]); setError(''); latest.current.onHold([]) } }, [selectionKey])
 const currentReview = (row: { id: string; listKey: string }) => { const item = byId.get(row.id); return props.selectedIds.includes(row.id) && !blocked.has(row.id) && Boolean(item && canBulkCompleteTask(item) && completionListKey(item) === row.listKey) }
 const stale = reviews.some(row => !currentReview(row))
 const disabled = props.disabled || props.otherBusy || props.refreshing || busy
 async function execute(kind: 'review' | 'confirm' | 'check') {
  if (disabled || writing.current || kind === 'confirm' && (stale || !reviews.length || results.length) || kind === 'check' && !plan) return
  writing.current = true; setBusy(true); props.onBusyChange(true); setError('')
  const current = ++generation.current, request = new AbortController(), scope = JSON.stringify([props.context.organizationId, props.context.userId]); controller.current = request
  const active = () => live.current && generation.current === current && !request.signal.aborted && !latest.current.disabled && JSON.stringify([latest.current.context.organizationId, latest.current.context.userId]) === scope
  const hooks = { active, signal: request.signal, onChanged: (receipt: Confirmed) => { if (active()) latest.current.onChanged(receipt) }, onAccessLost: (cause: unknown, id: string) => { if (active()) latest.current.onAccessLost(cause, id) }, onProgress: (rows: BulkTaskCompletionOutcome[]) => { if (active()) setResults(rows) }, isCurrent: (row: BulkTaskCompletionPlan[number]) => { const item = latest.current.items.find(item => item.id === row.id); return latest.current.selectedIds.includes(row.id) && !latest.current.blockedIds.includes(row.id) && Boolean(item && canBulkCompleteTask(item) && item.taskId === row.input.taskId && completionListKey(item) === row.listKey) } }
  try {
   if (kind === 'review') {
    const selected = props.selectedIds.map(id => byId.get(id))
    if (!selected.length || selected.some(row => !row || !canBulkCompleteTask(row) || blocked.has(row.id))) throw new Error('Select available open tasks before reviewing.')
    const keys = new Map(selected.map(row => [row!.id, completionListKey(row!)]))
    setReviews([]); setPlan(null); setResults([]); props.onHold([])
    const snapshots = await previewBulkTaskCompletion(props.selectedIds, props.context, hooks)
    if (!active()) return
    const rows = snapshots.map(row => ({ ...row, listKey: keys.get(row.id)! }))
    if (rows.some(row => { const item = latest.current.items.find(item => item.id === row.id); return !item || item.taskId !== row.task.id || completionListKey(item) !== row.listKey || latest.current.blockedIds.includes(row.id) })) throw new Error('Selected tasks changed. Review again before completing.')
    setReviews(rows); latest.current.onHold(rows.map(row => row.id))
   } else {
    const frozen = kind === 'check' ? plan! : makeBulkTaskCompletionPlan(reviews.map(row => ({ id: row.id, listKey: row.listKey, input: { requestId: crypto.randomUUID(), expectedVersion: row.version, taskId: row.task.id } })))
    if (kind === 'confirm') { setPlan(frozen); latest.current.onHold(frozen.map(row => row.id)); setResults(frozen.map(row => ({ id: row.id, state: 'not-attempted', message: 'Not attempted.' }))) }
    const next = kind === 'check' ? await verifyBulkTaskCompletion(frozen, results, props.context, hooks) : await runBulkTaskCompletion(frozen, props.context, hooks)
    if (active()) setResults(next)
   }
  } catch (cause) { if (active()) setError(cause instanceof Error ? cause.message : 'Task completion could not be confirmed. Review again.') }
  finally { if (live.current && generation.current === current) { writing.current = false; controller.current = null; setBusy(false); latest.current.onBusyChange(false) } }
 }
 const confirmed = results.filter(row => ['completed', 'verified'].includes(row.state)).length, checking = results.some(row => ['unconfirmed', 'failed'].includes(row.state))
 return <section aria-label="Bulk task completion" aria-busy={busy} className="space-y-3 rounded-lg border bg-card p-4">
  <h2 className="text-sm font-medium">Bulk task completion</h2><p className="text-sm">{props.selectedIds.length} selected · up to {BULK_TASK_COMPLETION_LIMIT} unique loaded tasks</p>
  <p className="text-xs text-muted-foreground">Review the exact linked tasks and confirm before completing. Your filters, order and unsent drafts are kept. No email is sent.</p>
  <div className="flex flex-wrap gap-2"><Button className="min-h-11" type="button" variant="outline" disabled={disabled || reviews.length > 0 || results.length > 0} onClick={() => props.onSelectionChange(uniqueCompletionSelection(props.items, props.blockedIds))}>Select up to 20 for completion</Button><Button className="min-h-11" type="button" variant="outline" disabled={disabled || !props.selectedIds.length} onClick={() => props.onSelectionChange([])}>Clear completion selection</Button><Button className="min-h-11" type="button" disabled={disabled || !props.selectedIds.length || results.length > 0} onClick={() => void execute('review')}>Review selected task completions</Button></div>
  {busy && <p role="status" className="text-sm">{plan ? 'Checking or confirming task completions…' : 'Loading selected task reviews…'}</p>}
  {reviews.length > 0 && results.length === 0 && <div role="group" aria-label="Bulk completion review" className="space-y-3"><p className="text-sm">Complete these CRM tasks? Each completion records an activity. Callback outcomes and email approvals stay separate. Processing stops on the first failure.</p>{reviews.map(row => { const item = byId.get(row.id), visible = item && canBulkCompleteTask(item) && item.taskId === row.task.id; return <div key={row.id} className="min-w-0 space-y-1 rounded-md border p-3 text-sm">{visible ? <><p className="break-words font-medium">{row.task.title}</p><p className="break-words">Lead: {row.leadName}</p><p className="break-words">Assigned to: {row.task.assigneeName || 'Team member'}{row.task.assigneeId === props.context.userId ? ' (you)' : ''}</p><p className="whitespace-pre-wrap break-words">{row.task.description || 'No task description.'}</p><p>Due <time dateTime={row.task.dueDate}>{new Date(row.task.dueDate).toLocaleString()}</time>. Dates use your browser timezone.</p></> : <p>Unavailable task</p>}</div> })}{stale && <p role="alert" className="text-sm text-destructive">Selected tasks changed. Review again before completing.</p>}<div className="flex flex-wrap gap-2"><Button className="min-h-11" type="button" disabled={disabled || stale} onClick={() => void execute('confirm')}>Confirm bulk completion</Button><Button className="min-h-11" type="button" variant="outline" disabled={disabled} onClick={() => { setReviews([]); setError(''); props.onHold([]) }}>Cancel bulk completion review</Button></div></div>}
  {results.length > 0 && <div className="space-y-2"><p role="status" className="text-sm">{confirmed} of {results.length} task completions confirmed or verified.</p><ul aria-label="Task completion results" className="space-y-1 text-sm">{results.map(row => { const item = byId.get(row.id), entry = plan?.find(value => value.id === row.id), visible = item && item.taskId === entry?.input.taskId && item.taskProgress && item.taskProgress.state !== 'UNAVAILABLE'; return <li key={row.id} className="break-words">{visible ? `${item.lead?.firstName ?? ''} ${item.lead?.lastName ?? ''}: ${item.title ?? 'Task'}` : 'Unavailable task'} — {row.message}</li> })}</ul><p className="text-xs text-muted-foreground">Completed tasks stay complete. Clearing this selection loses its exact request checks. Clear and review remaining open tasks before another attempt.</p>{checking && <><p className="text-xs text-muted-foreground">Check results only reads the exact attempted requests. It never repeats completion or submits unattempted tasks.</p><Button className="min-h-11" type="button" variant="outline" disabled={disabled} onClick={() => void execute('check')}>Check completion results</Button></>}</div>}
  {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
 </section>
}
