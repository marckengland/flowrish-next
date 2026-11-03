'use client'
import { useContext, useEffect, useRef, useState } from 'react'
import { QueryClientContext } from '@tanstack/react-query'
import { taskQueryRoot } from '@/lib/task-query-root'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { CallbackTimeError, preferredTimeLabel, resolveCallbackTime } from '@/lib/callback-time'
import { Input } from '@/components/ui/input'
import { callbackOutcomeDetailSchema, callbackOutcomeDraftSchema, callbackOutcomePreviewSchema, callbackOutcomeAckSchema, callbackOutcomeQueueSchema, type CallbackOutcomeDetail, type CallbackOutcomePreview, type CallbackOutcomeQueue as Queue, type CallbackOutcomeAction } from '@/lib/callback-outcomes'
const field = 'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
const results = { reached: 'Reached', no_answer: 'No answer', retry: 'Needs another attempt' }
type Props = ({ callbackId: string; taskId?: never } | { taskId: string; callbackId?: never }) & { onSaved?: (action: CallbackOutcomeAction) => void }
class RequestError extends Error { constructor(readonly status: number) { super('Request unavailable') } }

export function CallbackOutcomeTracker(props: Props) {
  const queryClient = useContext(QueryClientContext)
  const [detail, setDetail] = useState<CallbackOutcomeDetail | null>(null), [preview, setPreview] = useState<CallbackOutcomePreview | null>(null)
  const [outcome, setOutcome] = useState(''), [action, setAction] = useState<CallbackOutcomeAction>('record'), [notes, setNotes] = useState(''), [owner, setOwner] = useState(''), [deadline, setDeadline] = useState(''), [approved, setApproved] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [older, setOlder] = useState(false)
  const active = useRef(true), lock = useRef(false), controller = useRef<AbortController | null>(null), pending = useRef<object | null>(null)
  const base = props.callbackId ? `/api/callback-outcomes/${props.callbackId}` : `/api/tasks/${props.taskId}/callback-outcomes`
  useEffect(() => { active.current = true; return () => { active.current = false; controller.current?.abort() } }, [])
  function invalidate() { setPreview(null); setApproved(false); pending.current = null }
  function edit(change: () => void) { invalidate(); setNotice(''); setError(''); change() }
  async function request(path: string, signal: AbortSignal, body?: unknown) {
    const response = await fetch(path, { cache: 'no-store', signal, ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
    if (!response.ok) throw new RequestError(response.status)
    return response.json() as Promise<unknown>
  }
  async function run(work: (signal: AbortSignal) => Promise<void>) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); controller.current = new AbortController()
    try { await work(controller.current.signal) }
    catch (cause) {
      if (active.current && !controller.current.signal.aborted) {
        if (cause instanceof RequestError && cause.status === 409) invalidate()
        if (cause instanceof RequestError && [403, 404].includes(cause.status)) setDetail(null)
        setError(cause instanceof RequestError && cause.status === 409 ? 'The callback or task changed. Reload outcome status and preview again. Your entries are preserved.' : 'Could not confirm this outcome. Reload status or retry the same confirmation. Access requires current callback ownership or organization admin rights and CRM permissions.')
      }
    } finally { lock.current = false; if (active.current) setBusy(false) }
  }
  async function readDetail(signal: AbortSignal, before?: number) {
    const next = z.object({ data: callbackOutcomeDetailSchema }).strict().parse(await request(`${base}${before ? `?before=${before}` : ''}`, signal)).data
    if ((props.callbackId && next.callbackId !== props.callbackId) || (props.taskId && next.taskId !== props.taskId) || (next.source && next.source.id !== next.callbackId) || (next.task && next.task.id !== next.taskId)) throw new Error('Unexpected callback response')
    if (active.current) { setDetail(next); setOlder(!!before) }
  }
  function load(before?: number) { void run(async signal => { await readDetail(signal, before); if (active.current) invalidate() }) }
  function review(event: React.FormEvent) {
    event.preventDefault(); if (!detail?.canEdit) return
    let draft
    try {
      if (action === 'reschedule' && detail.preferredTime && !detail.callbackHours) throw new CallbackTimeError('Saved business callback hours need administrator review before rescheduling.')
      const dueDate = action !== 'reschedule' ? null : detail.preferredTime ? resolveCallbackTime({ localTime: deadline, timeZone: detail.callbackHours!.timeZone, businessVersion: detail.callbackHours!.version }, detail.callbackHours!).at : new Date(deadline).toISOString()
      draft = callbackOutcomeDraftSchema.parse({ outcome, action, notes, assigneeId: action === 'reschedule' ? owner : null, dueDate }) }
    catch (cause) { if (cause instanceof CallbackTimeError) { setError(cause.message); return } setError('Choose a result. Rescheduling needs an organization owner and valid future deadline.'); return }
    invalidate(); setNotice('')
    const input = { draft, expectedVersion: detail.version }
    void run(async signal => {
      const next = z.object({ data: callbackOutcomePreviewSchema }).strict().parse(await request(`${base}/preview`, signal, input)).data
      if (next.callbackId !== detail.callbackId || next.expectedVersion !== detail.version || JSON.stringify(next.draft) !== JSON.stringify(draft)) throw new Error('Unexpected preview')
      if (active.current) setPreview(next)
    })
  }
  function confirm() {
    if (!preview || !approved) return
    const body = pending.current ?? { draft: preview.draft, expectedVersion: preview.expectedVersion, previewVersion: preview.version, requestId: crypto.randomUUID(), confirmed: true }
    pending.current = body
    void run(async signal => {
      const ack = z.object({ data: callbackOutcomeAckSchema }).strict().parse(await request(base, signal, body)).data
      const sent = body as { requestId: string }
      if (ack.callbackId !== preview.callbackId || ack.requestId !== sent.requestId || ack.action !== preview.draft.action) throw new Error('Unexpected confirmation')
      if (!active.current) return
      invalidate(); setOutcome(''); setNotes(''); setAction('record'); setOwner(''); setDeadline('')
      setNotice(ack.action === 'close' ? 'Callback closed and task completed.' : ack.action === 'reschedule' ? 'Callback rescheduled.' : 'Callback outcome recorded.')
      void queryClient?.invalidateQueries({ queryKey: taskQueryRoot })
      props.onSaved?.(ack.action)
      if (active.current) {
        try { await readDetail(signal) }
        catch { if (active.current && !signal.aborted) { setDetail(null); setError('Outcome saved. Its current details could not be loaded; the callback may now belong to another owner.') } }
      }
    })
  }
  return <section aria-label="Callback outcome tracking" className="space-y-3 border-t pt-3 text-sm">
    <Button type="button" variant="outline" className="min-h-11 whitespace-normal" disabled={busy} onClick={() => load()}>{detail ? 'Reload outcome status' : 'Track callback outcome'}</Button>
    {busy && <p role="status">Working on callback outcome…</p>}{notice && <p role="status">{notice}</p>}{error && <p role="alert" className="text-destructive">{error}</p>}
    {detail && <>
      <p className="font-medium">{detail.closed ? 'Request closed' : 'Request open'}</p>
      {detail.preferredTime && <p>Requested callback time: {preferredTimeLabel(detail.preferredTime)}</p>}
      {detail.task ? <div className="space-y-1"><p className="break-words">{detail.task.title}</p><p>Owner: {detail.task.assigneeName}</p>{detail.preferredTime ? <p>Confirmed callback time: {new Date(detail.task.dueDate).toLocaleString('en-US', { timeZone: detail.callbackHours?.timeZone ?? detail.preferredTime.timeZone })} ({detail.callbackHours?.timeZone ?? detail.preferredTime.timeZone})</p> : <p>Deadline: {new Date(detail.task.dueDate).toLocaleString()}</p>}<p>Task: {detail.task.isComplete ? 'Complete' : 'Open'}</p></div> : <p>The original task or active lead is unavailable. History is retained; no task will be recreated.</p>}
      {!detail.source && <p className="text-muted-foreground">The source callback has been removed. Its CRM work and history are retained.</p>}
      {detail.canEdit && <form onSubmit={review} className="space-y-3"><fieldset disabled={busy} className="min-w-0 space-y-3">
        <label className="block space-y-1"><span>Callback result</span><select className={field} value={outcome} required onChange={event => edit(() => setOutcome(event.target.value))}><option value="">Choose a staff-reported result</option>{Object.entries(results).map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>
        <label className="block space-y-1"><span>Outcome notes</span><textarea className={field} rows={3} maxLength={2000} value={notes} onChange={event => edit(() => setNotes(event.target.value))} /></label>
        <label className="block space-y-1"><span>Next action</span><select className={field} value={action} onChange={event => edit(() => setAction(event.target.value as CallbackOutcomeAction))}><option value="record">Record result only</option><option value="reschedule">Reschedule existing task</option><option value="close">Close callback and complete task</option></select></label>
        {action === 'reschedule' && <>
          <label className="block space-y-1"><span>Next callback owner</span><select className={field} required value={owner} onChange={event => edit(() => setOwner(event.target.value))}><option value="">Choose an organization member</option>{detail.members.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>
          {detail.membersTruncated && <p>Only the first 200 owners are shown. Ask an administrator if the owner is missing.</p>}
          <label className="block space-y-1"><span>{detail.preferredTime ? 'Next callback time' : 'Next callback deadline'}</span><Input type="datetime-local" required value={deadline} onChange={event => edit(() => setDeadline(event.target.value))} /></label><p className="text-muted-foreground">{detail.preferredTime ? `Business time zone: ${detail.callbackHours?.timeZone ?? detail.preferredTime.timeZone}. Choose within saved callback hours; the preview requires fresh approval.` : 'Your local time zone; the review shows the exact deadline.'}</p>
        </>}
        <Button type="submit" variant="outline" className="min-h-11">Preview outcome</Button>
      </fieldset></form>}
      <div role="region" className="space-y-3" aria-label="Callback outcome history"><h4 className="font-semibold">Outcome history</h4>{!detail.history.length && <p>No outcomes recorded on this page.</p>}{detail.history.map(row => <article key={row.id} className="space-y-1 rounded-md border p-3"><p>{results[row.outcome]} · {row.action === 'close' ? 'Request closed' : row.action === 'reschedule' ? 'Rescheduled' : 'Result recorded'}</p><p>{row.createdByName} · {new Date(row.createdAt).toLocaleString()} · Attempt {row.sequence}</p><p className="whitespace-pre-wrap break-words">{row.notes}</p>{row.dueDate && (detail.preferredTime ? <p>Next: {row.assigneeName} · {new Date(row.dueDate).toLocaleString('en-US', { timeZone: detail.callbackHours?.timeZone ?? detail.preferredTime.timeZone })} ({detail.callbackHours?.timeZone ?? detail.preferredTime.timeZone})</p> : <p>Next: {row.assigneeName} · {new Date(row.dueDate).toLocaleString()}</p>)}</article>)}<div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy || !older} onClick={() => load()}>Latest outcomes</Button><Button type="button" variant="outline" disabled={busy || !detail.hasMore} onClick={() => load(detail.beforeNext!)}>Older outcomes</Button></div></div>
    </>}
    {preview && <div aria-label="Callback outcome preview" className="space-y-3 rounded-md border p-3"><h4 className="font-semibold">Review callback outcome</h4><p className="break-words">Task: {preview.taskTitle}</p><p>Result: {results[preview.draft.outcome]}</p><p className="whitespace-pre-wrap break-words">{preview.draft.notes}</p><p>{preview.taskChange}</p><p>{preview.sourceChange}</p>{preview.confirmedTime && <p>Staff-confirmed callback time: {preferredTimeLabel(preview.confirmedTime)}</p>}{preview.nextDueDate && !preview.confirmedTime && <p>Next: {preview.nextOwner} · {new Date(preview.nextDueDate).toLocaleString()} ({Intl.DateTimeFormat().resolvedOptions().timeZone})</p>}{preview.reopensTask && <p>This reopens the completed task.</p>}<p>This saves staff-reported CRM history. Flowrish will not call or message the visitor. Closing is final in this workflow.</p><label className="flex min-h-11 items-start gap-2"><input type="checkbox" disabled={busy} checked={approved} onChange={event => setApproved(event.target.checked)} />I approve recording this result and the task/request changes shown above.</label><Button type="button" className="min-h-11" disabled={busy || !approved} onClick={confirm}>Confirm callback outcome</Button></div>}
  </section>
}

export function CallbackOutcomeQueue({ onClosed }: { onClosed?: () => void } = {}) {
  const [filter, setFilter] = useState('overdue'), [loadedFilter, setLoadedFilter] = useState('overdue'), [data, setData] = useState<Queue | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const lock = useRef(false), active = useRef(true), controller = useRef<AbortController | null>(null)
  useEffect(() => { active.current = true; return () => { active.current = false; controller.current?.abort() } }, [])
  async function load(selected = filter, page = 1) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); controller.current = new AbortController()
    try {
      const response = await fetch(`/api/callback-outcomes?filter=${selected}&page=${page}`, { cache: 'no-store', signal: controller.current.signal })
      if (!response.ok) throw new Error('Unavailable')
      const next = z.object({ data: callbackOutcomeQueueSchema }).strict().parse(await response.json()).data
      if (next.page !== page) throw new Error('Unexpected page')
      if (active.current) { setData(next); setLoadedFilter(selected) }
    } catch { if (active.current && !controller.current.signal.aborted) { setData(null); setError('Could not load callback work. Current organization membership and CRM permissions are required.') } }
    finally { lock.current = false; if (active.current) setBusy(false) }
  }
  return <section id="callback-work" aria-label="Callback work queue" className="space-y-3 rounded-md border p-3 text-sm"><h3 className="font-semibold">Callback work queue</h3><p>Open requests handed to CRM. Staff see their assigned work; organization administrators see all. Overdue excludes completed tasks.</p><label className="block space-y-1"><span>Callback work filter</span><select className={field} value={filter} disabled={busy} onChange={event => setFilter(event.target.value)}><option value="overdue">Overdue</option><option value="open">Open requests</option><option value="closed">Closed requests</option><option value="all">All requests</option></select></label><Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void load()}>{data ? 'Reload callback work queue' : 'Load callback work queue'}</Button>{busy && <p role="status">Loading callback work…</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{data && <><p>Showing {loadedFilter} · Page {data.page}</p>{!data.rows.length && <p>No callback work in this view.</p>}{data.rows.map(row => <article key={row.callbackId} className="space-y-2 rounded-md border p-3" aria-label={`Callback work: ${row.title}`}><p className="break-words font-medium">{row.title}</p><p>{row.assigneeName} · {new Date(row.dueDate).toLocaleString()}</p><p>{row.closed ? 'Request closed' : 'Request open'} · Task {row.isComplete ? 'complete' : 'open'}</p>{row.latestOutcome && <p>Last result: {results[row.latestOutcome]}</p>}<CallbackOutcomeTracker callbackId={row.callbackId} onSaved={action => { setNotice(action === 'close' ? 'Callback closed and task completed.' : action === 'reschedule' ? 'Callback rescheduled.' : 'Callback outcome recorded.'); if (action === 'close') onClosed?.(); void load(loadedFilter, data.page) }} /></article>)}<div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy || data.page === 1} onClick={() => void load(loadedFilter, data.page - 1)}>Previous callback work page</Button><Button type="button" variant="outline" disabled={busy || !data.hasMore} onClick={() => void load(loadedFilter, data.page + 1)}>Next callback work page</Button></div></>}</section>
}
