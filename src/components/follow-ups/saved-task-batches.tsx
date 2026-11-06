'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { RemainingTasks, type RemainingTaskControls } from './remaining-tasks'
import { Button } from '@/components/ui/button'
import { followUpHeaders, type FollowUpContext } from '@/lib/follow-up-access'
import { followUpData, followUpAccessLost, FollowUpClientError } from '@/lib/follow-up-client'
import { taskBatchList, taskBatchDetail, TASK_BATCH_EVENT, type TaskBatchList, type TaskBatchDetail } from '@/lib/follow-up-task-batches'
type Props = { context: FollowUpContext; onAccessLost: (cause: unknown) => void; recovery?: RemainingTaskControls }
export function SavedTaskBatches(props: Props) { return <History key={JSON.stringify([props.context.organizationId, props.context.userId])} {...props} /> }
function History({ context, onAccessLost, recovery }: Props) {
 const [open, setOpen] = useState(false), [list, setList] = useState<TaskBatchList>({ items: [], nextCursor: null }), [detail, setDetail] = useState<TaskBatchDetail | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [loaded, setLoaded] = useState(false)
 const [recoveryBusy, setRecoveryBusy] = useState(false)
 const recoveryActive = useRef(false), refreshPending = useRef(false), latestRecovery = useRef(recovery); latestRecovery.current = recovery
 const live = useRef(true), sequence = useRef(0), controller = useRef<AbortController | null>(null), selected = useRef<string | null>(null), latest = useRef(onAccessLost)
 latest.current = onAccessLost
 const read = useCallback(async (mode: 'refresh' | 'older' | 'detail', id?: string) => {
  if (recoveryActive.current) { refreshPending.current = true; return }
  const current = ++sequence.current; controller.current?.abort(); const request = new AbortController(); controller.current = request
  const active = () => live.current && sequence.current === current && !request.signal.aborted
  const timer = setTimeout(() => request.abort(), 25000)
  setBusy(true); setError('')
  async function get(path: string) { return followUpData(await fetch(path, { method: 'GET', cache: 'no-store', headers: followUpHeaders(context), signal: request.signal }), context) }
  async function getDetail(id: string) { const response = await get('/api/follow-ups/batches/' + encodeURIComponent(id)); return { ...taskBatchDetail.parse(response.data), canReview: response.canWrite === true } }
  try {
   if (mode === 'detail') {
    if (!id) return
    selected.current = id; setDetail(null)
    const result = await getDetail(id)
    if (result.id !== id) throw new Error('Unexpected saved batch')
    if (active()) setDetail(result)
   } else {
    const result = taskBatchList.parse((await get('/api/follow-ups/batches' + (mode === 'older' && id ? '?cursor=' + encodeURIComponent(id) : ''))).data)
    if (!active()) return
    setList(previous => mode === 'older' ? { ...result, items: [...previous.items, ...result.items.filter(row => !previous.items.some(old => old.id === row.id))] } : result); setLoaded(true)
    if (selected.current) {
     const chosen = selected.current, result = await getDetail(chosen)
     if (result.id !== chosen) throw new Error('Unexpected saved batch')
     if (active()) setDetail(result)
    }
   }
  } catch (cause) {
   if (!live.current || sequence.current !== current) return
   setList({ items: [], nextCursor: null }); setDetail(null); selected.current = null
   setError('Saved history could not be checked. Refresh history before relying on these results.')
   if (followUpAccessLost(cause) && !(cause instanceof FollowUpClientError && cause.status === 404)) latest.current(cause)
  } finally { clearTimeout(timer); if (live.current && sequence.current === current) setBusy(false) }
 }, [context])
 const changeRecoveryBusy = useCallback((value: boolean) => { const was = recoveryActive.current; if (was === value) return; recoveryActive.current = value; setRecoveryBusy(value); latestRecovery.current?.onBusyChange(value); if (was && !value && refreshPending.current) { refreshPending.current = false; void read('refresh') } }, [read])
 useEffect(() => { const life = live, counter = sequence, pending = controller; life.current = true; return () => { life.current = false; counter.current++; pending.current?.abort() } }, [])
 useEffect(() => {
  if (!open) return
  const counter = sequence, pending = controller
  void read('refresh')
  const refresh = () => { if (document.visibilityState === 'visible') void read('refresh') }
  window.addEventListener('focus', refresh); window.addEventListener(TASK_BATCH_EVENT, refresh)
  return () => { window.removeEventListener('focus', refresh); window.removeEventListener(TASK_BATCH_EVENT, refresh); pending.current?.abort(); counter.current++ }
 }, [open, read])
 const labels = { confirmed: 'Confirmed', failed: 'Failed', uncertain: 'Uncertain', 'not-attempted': 'Not attempted', unavailable: 'Unavailable' }
 return <details className="min-w-0 rounded-lg border bg-card p-4" onToggle={event => setOpen(event.currentTarget.open)}>
  <summary className="cursor-pointer rounded text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">Saved bulk-action history</summary>
  <div role="group" aria-label="Saved task batch history" aria-busy={busy} className="mt-3 min-w-0 space-y-3 text-sm">
   <p>Reviewed completion and deadline batches are private to you in this workspace. Checking history only reads exact saved requests. It never resumes or repeats changes.</p>
   {open && <Button type="button" variant="outline" disabled={busy || recoveryBusy} onClick={() => void read('refresh')}>Refresh history</Button>}
   {busy && <p role="status">Checking saved history…</p>}
   {error && <p role="alert" className="text-destructive">{error}</p>}
   {loaded && !error && list.items.length === 0 && <p>No saved bulk actions yet. Earlier actions and unconfirmed reviews are not included.</p>}
   <ul className="space-y-2">{list.items.map(batch => <li key={batch.id} className="space-y-2 rounded border p-3">
    <p>{batch.kind === 'COMPLETE' ? 'Task completion' : 'Deadline rescheduling'} · <time dateTime={batch.createdAt}>{new Date(batch.createdAt).toLocaleString()}</time></p>
    <p>{Object.entries(batch.counts).map(([key, count]) => `${labels[key as keyof typeof labels]}: ${count}`).join(' · ')}</p>
    <Button type="button" variant="outline" disabled={busy || recoveryBusy} onClick={() => void read('detail', batch.id)} aria-label={`View ${batch.kind === 'COMPLETE' ? 'completion' : 'rescheduling'} batch ${new Date(batch.createdAt).toLocaleString()}`}>View saved results</Button>
   </li>)}</ul>
   {list.nextCursor && <Button type="button" variant="outline" disabled={busy || recoveryBusy} onClick={() => void read('older', list.nextCursor!)}>Older batches</Button>}
   {detail && <section aria-label="Saved batch results" className="space-y-3 rounded border p-3">
    <h2 className="font-medium">{detail.kind === 'COMPLETE' ? 'Saved completion results' : 'Saved deadline results'}</h2>
    <p>Checked <time dateTime={detail.checkedAt}>{new Date(detail.checkedAt).toLocaleString()}</time>. An uncertain request may still finish; no matching receipt is not proof that nothing changed. Make a fresh review before any new action.</p>
    <Button type="button" variant="outline" disabled={busy || recoveryBusy} onClick={() => void read('refresh')}>Check saved results</Button>
    <ol className="space-y-3">{detail.items.map(row => <li key={row.index} className="min-w-0 space-y-1 border-t pt-2">
     {row.state === 'unavailable' ? <p>Unavailable task</p> : <><p className="break-words font-medium">{row.task.title}</p><p className="break-words">{row.task.leadName} · {labels[row.state]}</p><p>Current deadline: <time dateTime={row.task.dueDate}>{new Date(row.task.dueDate).toLocaleString()}</time> · {row.task.isComplete ? 'Completed' : 'Open'}</p>
      {row.currentChanged && <p>Changed since this action.</p>}
      {row.reviewedDeadline && <p>Reviewed deadline: <time dateTime={row.reviewedDeadline.previousDueDate}>{new Date(row.reviewedDeadline.previousDueDate).toLocaleString()}</time> → <time dateTime={row.reviewedDeadline.dueDate}>{new Date(row.reviewedDeadline.dueDate).toLocaleString()}</time> ({row.reviewedDeadline.timeZone}; displayed dates use your browser timezone).</p>}
      <div className="flex flex-wrap gap-3"><Link className="rounded underline focus-visible:ring-2 focus-visible:ring-ring" target="_blank" rel="noopener noreferrer" href={'/tasks/' + encodeURIComponent(row.task.id)}>Open task (new tab)</Link><Link className="rounded underline focus-visible:ring-2 focus-visible:ring-ring" target="_blank" rel="noopener noreferrer" href={'/leads/' + encodeURIComponent(row.task.leadId)}>Open lead (new tab)</Link></div>
     </>}
    </li>)}</ol>
    {recovery && <RemainingTasks key={detail.id} detail={detail} context={context} {...recovery} onBusyChange={changeRecoveryBusy} onAccessLost={onAccessLost} />}
   </section>}
  </div>
 </details>
}
