'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { rehearsalReviewSchema, rehearsalSnapshotSchema } from '@/lib/receptionist-rehearsal'
import type { RehearsalReport, RehearsalReview, RehearsalSnapshot, RehearsalSummary } from '@/lib/receptionist-rehearsal'

const endpoint = '/api/admin/receptionist/rehearsals'
const metadataSchema = z.object({ id: z.string().uuid(), title: z.string().min(1).max(120), createdAt: z.string().datetime(), updatedAt: z.string().datetime() }).passthrough()
function parseSummary(value: unknown): RehearsalSummary {
  const item = metadataSchema.parse(value)
  const review = rehearsalReviewSchema.parse({ verdict: item.verdict, notes: item.notes, unansweredMessageIndexes: item.unansweredMessageIndexes })
  return { id: item.id, title: item.title, createdAt: item.createdAt, updatedAt: item.updatedAt, ...review }
}
function parseReport(value: unknown): RehearsalReport {
  const summary = parseSummary(value)
  const snapshot = rehearsalSnapshotSchema.parse(metadataSchema.parse(value).snapshot)
  if (summary.unansweredMessageIndexes.some(index => snapshot.messages[index]?.role !== 'caller')) throw new Error('Invalid review')
  return { ...summary, snapshot }
}
const emptyReview: RehearsalReview = { verdict: 'unreviewed', notes: '', unansweredMessageIndexes: [] }
type Operation = 'save' | 'history' | 'detail' | 'review' | 'delete'
type RequestError = { message: string; retry: Operation; id?: string; conflict?: boolean }

export function ReceptionistRehearsalReports({ snapshot, disabled }: { snapshot: RehearsalSnapshot | null; disabled: boolean }): React.JSX.Element {
  const ids = useId()
  const [title, setTitle] = useState('Browser rehearsal')
  const [history, setHistory] = useState<RehearsalSummary[] | null>(null)
  const [detail, setDetail] = useState<RehearsalReport | null>(null)
  const [review, setReview] = useState<RehearsalReview>(emptyReview)
  const [busy, setBusy] = useState<Operation | null>(null)
  const [error, setError] = useState<RequestError | null>(null)
  const [message, setMessage] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set())
  const request = useRef<AbortController | null>(null)
  useEffect(() => {
    request.current?.abort()
    request.current = null
    setBusy(null)
    setError(null)
    setMessage('')
    setConfirmDelete(false)
    return () => { request.current?.abort() }
  }, [snapshot, disabled])

  function showDetail(next: RehearsalReport) {
    setDetail(next)
    setReview({ verdict: next.verdict, notes: next.notes, unansweredMessageIndexes: [...next.unansweredMessageIndexes] })
    setHistory(previous => previous?.map(item => item.id === next.id ? next : item) ?? null)
  }

  async function run(operation: Operation, work: (signal: AbortSignal) => Promise<() => void>, id?: string) {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(operation)
    setError(null)
    setMessage('')
    setConfirmDelete(false)
    try {
      const apply = await work(controller.signal)
      if (!controller.signal.aborted && request.current === controller) apply()
    } catch {
      if (!controller.signal.aborted && request.current === controller) {
        if (operation === 'delete') setConfirmDelete(true)
        setError({ message: 'Could not complete this request. Your changes are still here. Please try again.', retry: operation, id })
      }
    } finally {
      if (!controller.signal.aborted && request.current === controller) setBusy(null)
    }
  }

  async function data(response: Response): Promise<unknown> {
    if (!response.ok) throw new Error('Request failed')
    const body = await response.json()
    return body?.data
  }

  function save() {
    if (disabled || busy || !snapshot || !title.trim() || savedIds.has(snapshot.clientId)) return
    const draft = snapshot
    void run('save', async signal => {
      const next = parseReport(await data(await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title.trim(), snapshot: draft }), signal })))
      return () => {
        showDetail(next)
        setSavedIds(previous => new Set(previous).add(draft.clientId))
        setHistory(previous => previous ? [next, ...previous.filter(item => item.id !== next.id)].slice(0, 25) : null)
        setMessage('Rehearsal saved.')
      }
    })
  }

  function loadHistory() {
    if (disabled || busy) return
    void run('history', async signal => {
      const result = await data(await fetch(endpoint, { method: 'GET', cache: 'no-store', signal }))
      if (!Array.isArray(result)) throw new Error('Invalid history')
      const next = result.slice(0, 25).map(parseSummary)
      return () => setHistory(next)
    })
  }

  function loadDetail(id: string) {
    if (disabled || (busy && busy !== 'detail')) return
    setDetail(null)
    void run('detail', async signal => {
      const next = parseReport(await data(await fetch(`${endpoint}/${encodeURIComponent(id)}`, { method: 'GET', cache: 'no-store', signal })))
      return () => showDetail(next)
    }, id)
  }

  function saveReview() {
    if (disabled || busy || !detail) return
    const selected = detail
    void run('review', async signal => {
      const response = await fetch(`${endpoint}/${encodeURIComponent(selected.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...review, expectedUpdatedAt: selected.updatedAt }), signal })
      if (response.status === 409) return () => setError({
        message: 'Another reviewer updated this rehearsal. Your edits are still here. Reload the latest rehearsal to review again; reloading replaces your local edits.',
        conflict: true, retry: 'detail', id: selected.id,
      })
      const next = parseReport(await data(response))
      return () => { showDetail(next); setMessage('Review saved.') }
    })
  }

  function deleteReport() {
    if (disabled || busy || !detail || !confirmDelete) return
    const selected = detail
    void run('delete', async signal => {
      const response = await fetch(`${endpoint}/${encodeURIComponent(selected.id)}`, { method: 'DELETE', signal })
      if (response.status !== 404) {
        const result = await data(response)
        if (!result || typeof result !== 'object' || !('deleted' in result) || result.deleted !== true) throw new Error('Invalid deletion')
      }
      return () => {
        setDetail(null)
        setHistory(previous => previous?.filter(item => item.id !== selected.id) ?? null)
        setSavedIds(previous => { const next = new Set(previous); next.delete(selected.snapshot.clientId); return next })
        setMessage('Rehearsal deleted.')
      }
    })
  }

  const locked = disabled || !!busy
  return (
    <Card aria-labelledby={`${ids}-heading`}>
      <CardHeader className="flex-col items-start gap-2">
        <CardTitle id={`${ids}-heading`}>Browser rehearsal reports</CardTitle>
        <p className="text-sm text-muted-foreground">Save a browser rehearsal for manual review. Saved reports are admin-submitted browser snapshots, separate from customer calls.</p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <label htmlFor={`${ids}-title`} className="text-sm font-medium">Rehearsal title</label>
          <Input id={`${ids}-title`} value={title} maxLength={120} disabled={locked} onChange={event => setTitle(event.target.value)} className="min-h-11" />
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="min-h-11" disabled={locked || !snapshot || !title.trim() || savedIds.has(snapshot.clientId)} onClick={save}>Save rehearsal</Button>
            <Button type="button" variant="outline" className="min-h-11" disabled={locked} onClick={loadHistory}>Load saved rehearsals</Button>
          </div>
          {!snapshot && <p className="text-sm text-muted-foreground">Run a browser preview before saving a rehearsal.</p>}
          {snapshot && savedIds.has(snapshot.clientId) && <p className="text-sm text-muted-foreground">This browser snapshot has been saved. Send another preview message to save a new snapshot.</p>}
        </div>
        <p role={busy || message ? 'status' : undefined} aria-atomic="true" className="text-sm">{busy ? ({ save: 'Saving rehearsal…', history: 'Loading saved rehearsals…', detail: 'Loading rehearsal…', review: 'Saving review…', delete: 'Deleting rehearsal…' }[busy]) : message}</p>
        {error && <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">{error.message}</p>
          <Button type="button" variant="outline" className="min-h-11" disabled={locked} onClick={() => { if (error.retry === 'save') save(); else if (error.retry === 'history') loadHistory(); else if (error.retry === 'review') saveReview(); else if (error.retry === 'delete') deleteReport(); else if (error.id) loadDetail(error.id) }}>{error.conflict ? 'Reload latest rehearsal' : 'Try again'}</Button>
        </div>}
        {history && <section aria-label="Saved rehearsals" className="space-y-2">
          <h3 className="text-sm font-medium">Latest saved rehearsals (up to 25)</h3>
          {history.length === 0 ? <p className="text-sm text-muted-foreground">No saved rehearsals yet.</p> : <ul className="space-y-2">
            {history.map(item => <li key={item.id}>
              <Button type="button" variant="outline" className="min-h-11 h-auto w-full justify-start whitespace-normal text-left break-words" disabled={disabled || (!!busy && busy !== 'detail')} aria-label={`Open ${item.title}`} onClick={() => loadDetail(item.id)}>
                <span className="min-w-0"><span className="block">{item.title}</span><span className="block text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()} · {item.verdict === 'needs_work' ? 'Needs work' : item.verdict === 'passed' ? 'Passed' : 'Unreviewed'}</span></span>
              </Button>
            </li>)}
          </ul>}
        </section>}
        {detail && <section aria-labelledby={`${ids}-detail`} className="space-y-4 border-t pt-4">
          <div className="space-y-1">
            <h3 id={`${ids}-detail`} className="font-medium break-words">{detail.title}</h3>
            <p className="text-sm text-muted-foreground">Saved browser snapshot · {new Date(detail.createdAt).toLocaleString()} · {detail.snapshot.finished ? 'Finished' : 'In progress'}</p>
            <p className="text-xs text-muted-foreground break-words">Saved settings version: {detail.snapshot.settingsVersion}</p>
            <p className="text-sm text-muted-foreground">Sources show knowledge supplied at rehearsal time. They do not verify an answer or current approval. Manual FAQs may also have been available.</p>
          </div>
          <ol aria-label="Saved rehearsal transcript" className="space-y-4">
            {detail.snapshot.messages.map((item, index) => <li key={index} className="space-y-2 text-sm">
              <p className="font-medium">{item.role === 'caller' ? 'Caller' : 'Receptionist'} · Generation: {item.generation}</p>
              <p className="whitespace-pre-wrap break-words">{item.content}</p>
              {item.sources.length > 0 && <ul aria-label={`Knowledge supplied for message ${index + 1}`} className="space-y-1 text-xs text-muted-foreground">
                {item.sources.map(source => <li key={source.id} className="break-words">{source.title} · revision {source.revision}</li>)}
              </ul>}
              {item.role === 'caller' && <label className="flex min-h-11 cursor-pointer items-center gap-2">
                <input type="checkbox" checked={review.unansweredMessageIndexes.includes(index)} disabled={locked} onChange={event => setReview(previous => ({ ...previous, unansweredMessageIndexes: event.target.checked ? [...previous.unansweredMessageIndexes, index] : previous.unansweredMessageIndexes.filter(value => value !== index) }))} />
                Needs knowledge<span className="sr-only"> for caller message {index + 1}</span>
              </label>}
            </li>)}
          </ol>
          <a href="/knowledge" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">Open knowledge library</a>
          <div className="space-y-2">
            <label htmlFor={`${ids}-verdict`} className="block text-sm font-medium">Manual review verdict</label>
            <select id={`${ids}-verdict`} value={review.verdict} disabled={locked} onChange={event => setReview(previous => ({ ...previous, verdict: event.target.value as RehearsalReview['verdict'] }))} className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="unreviewed">Unreviewed</option><option value="passed">Passed</option><option value="needs_work">Needs work</option>
            </select>
            <label htmlFor={`${ids}-notes`} className="block text-sm font-medium">Review notes</label>
            <textarea id={`${ids}-notes`} maxLength={2000} rows={3} value={review.notes} disabled={locked} onChange={event => setReview(previous => ({ ...previous, notes: event.target.value }))} className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
            <p className="text-xs text-muted-foreground">Human review only. This verdict does not grade or verify the AI automatically.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" className="min-h-11" disabled={locked || !!error?.conflict} onClick={saveReview}>Save review</Button>
              <Button type="button" variant="outline" className="min-h-11" disabled={locked} onClick={() => setConfirmDelete(true)}>Delete saved rehearsal</Button>
            </div>
          </div>
          {confirmDelete && <div className="space-y-2 rounded-md border border-destructive p-3" role="group" aria-label="Confirm rehearsal deletion">
            <p className="text-sm">Delete this saved rehearsal and its review? This cannot be undone.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="destructive" className="min-h-11" disabled={locked} onClick={deleteReport}>Confirm deletion</Button>
              <Button type="button" variant="outline" className="min-h-11" disabled={locked} onClick={() => { setConfirmDelete(false); if (error?.retry === 'delete') setError(null) }}>Cancel deletion</Button>
            </div>
          </div>}
        </section>}
      </CardContent>
    </Card>
  )
}
