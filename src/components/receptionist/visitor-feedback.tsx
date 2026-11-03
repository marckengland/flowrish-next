'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { feedbackFaqSchema, feedbackListSchema, feedbackPolicySchema, type VisitorFeedbackList, type VisitorFeedbackPolicy } from '@/lib/visitor-feedback'

const base = '/api/admin/website-receptionist', field = 'min-h-11 rounded-md border border-input bg-background px-3 py-2 text-sm'
type Filter = 'open' | 'dismissed' | 'all'
class RequestError extends Error { constructor(readonly status: number) { super('Feedback request unavailable') } }
export function VisitorFeedbackInbox(): React.JSX.Element {
  const [policy, setPolicy] = useState<VisitorFeedbackPolicy | null>(null), [enabled, setEnabled] = useState(false), [acknowledged, setAcknowledged] = useState(false)
  const [data, setData] = useState<VisitorFeedbackList | null>(null), [filter, setFilter] = useState<Filter>('open'), [loadedFilter, setLoadedFilter] = useState<Filter>('open'), [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [deleteId, setDeleteId] = useState<string | null>(null), [savedFaq, setSavedFaq] = useState<z.infer<typeof feedbackFaqSchema> | null>(null)
  const mounted = useRef(true), controller = useRef<AbortController | null>(null), dirty = !!policy && policy.enabled !== enabled
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); controller.current = null } }, [])
  async function request(path: string, signal: AbortSignal, body?: unknown, method = 'PATCH'): Promise<unknown> {
    const response = await fetch(path, { cache: 'no-store', signal, ...(body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }); if (!response.ok) throw new RequestError(response.status); return response.json()
  }
  async function run(action: (signal: AbortSignal, active: () => boolean) => Promise<void>) {
    if (controller.current) return
    const current = new AbortController(); controller.current = current; setBusy(true); setError(''); setNotice('')
    const active = () => mounted.current && controller.current === current && !current.signal.aborted
    try { await action(current.signal, active) }
    catch (cause) { if (active()) { if (cause instanceof RequestError && cause.status === 403) { setData(null); setPolicy(null); setSavedFaq(null) }; if (cause instanceof RequestError && cause.status === 409) setData(null); setError(cause instanceof RequestError && cause.status === 409 ? 'Feedback changed elsewhere. Reload feedback or settings before trying again. Your setting edits are kept.' : 'Could not load or save visitor feedback. Reload and try again.') } }
    finally { if (controller.current === current) { controller.current = null; if (mounted.current) setBusy(false) } }
  }
  async function readList(signal: AbortSignal, status: Filter, page: number): Promise<VisitorFeedbackList> {
    const result = z.object({ data: feedbackListSchema }).strict().parse(await request(`${base}/feedback?status=${status}&page=${page}`, signal)).data
    if (result.page !== page) throw new Error('Unexpected page')
    return !result.rows.length && page > 1 ? readList(signal, status, 1) : result
  }
  function loadPolicy() {
    if (dirty && !window.confirm('Discard unsaved feedback settings and reload?')) return
    void run(async (signal, active) => { const next = z.object({ data: feedbackPolicySchema }).strict().parse(await request(`${base}/feedback-policy`, signal)).data; if (active()) { setPolicy(next); setEnabled(next.enabled); setAcknowledged(false) } })
  }
  function savePolicy() {
    if (!policy?.updatedAt || enabled && !acknowledged) return
    void run(async (signal, active) => { const next = z.object({ data: feedbackPolicySchema }).strict().parse(await request(`${base}/feedback-policy`, signal, { enabled, acknowledged, expectedUpdatedAt: policy.updatedAt })).data; if (active()) { setPolicy(next); setEnabled(next.enabled); setAcknowledged(false); setNotice('Feedback settings saved.') } })
  }
  function loadList(status = filter, page = 1) { void run(async (signal, active) => { setData(null); setDeleteId(null); const next = await readList(signal, status, page); if (active()) { setData(next); setLoadedFilter(status); setLoaded(true) } }) }
  async function refreshAfterWrite(signal: AbortSignal, active: () => boolean) {
    try { const next = await readList(signal, loadedFilter, data?.page ?? 1); if (active()) setData(next) }
    catch { if (active()) { setData(null); setError('The change was saved, but feedback could not be refreshed. Reload visitor feedback.') } }
  }
  function createFaq(row: VisitorFeedbackList['rows'][number]) {
    void run(async (signal, active) => { const result = z.object({ data: feedbackFaqSchema }).strict().parse(await request(`${base}/feedback/${row.id}/faq`, signal, { expectedUpdatedAt: row.updatedAt }, 'POST')).data; if (!active()) return; setSavedFaq(result); setNotice('FAQ draft saved for human review. Add and verify an answer in Library before publishing or approving it.'); await refreshAfterWrite(signal, active) })
  }
  function change(row: VisitorFeedbackList['rows'][number], action: 'dismiss' | 'reopen' | 'delete') {
    if (action === 'delete' && deleteId !== row.id) return
    void run(async (signal, active) => { z.object({ data: z.object({ saved: z.literal(true) }).strict() }).strict().parse(await request(`${base}/feedback/${row.id}`, signal, { action, expectedUpdatedAt: row.updatedAt })); if (!active()) return; setDeleteId(null); setNotice(action === 'delete' ? 'Feedback deleted. FAQ drafts remain in Library.' : action === 'dismiss' ? 'Feedback dismissed.' : 'Feedback reopened.'); await refreshAfterWrite(signal, active) })
  }
  return <div className="min-w-0 space-y-6">
    <section aria-labelledby="feedback-settings-title" className="space-y-4 rounded-xl border bg-card p-4 sm:p-5"><h2 id="feedback-settings-title" className="text-lg font-semibold">Question saving</h2><p className="text-sm text-muted-foreground">Off by default. Visitors must review their question and agree to save it. Reports expire after 30 days and are removed during daily cleanup. Changing this setting resets active website chats and does not enable the receptionist.</p><Button className="min-h-11" variant="outline" disabled={busy} onClick={loadPolicy}>{policy ? 'Reload feedback settings' : 'Load feedback settings'}</Button>
      {policy && <><p className="text-sm">Saved feedback setting: {policy.enabled ? 'On' : 'Off'}</p>{!policy.configured && <p className="text-sm">Save website receptionist settings first in <Link className="underline" href="/receptionist/setup">guided setup</Link>.</p>}<label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={enabled} disabled={busy || !policy.configured} onChange={event => { setEnabled(event.target.checked); setAcknowledged(false) }} />Allow visitors to save feedback</label><label className="flex min-h-11 items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={acknowledged} disabled={busy || !policy.configured} onChange={event => setAcknowledged(event.target.checked)} />I reviewed question saving and expiry. Each visitor must separately agree to save their question.</label><Button className="min-h-11" disabled={busy || !policy.configured || enabled && !acknowledged} onClick={savePolicy}>Save feedback settings</Button>{dirty && <p className="text-sm text-muted-foreground">Unsaved feedback settings</p>}</>}
    </section>
    <section aria-labelledby="visitor-feedback-title" className="space-y-4"><h2 id="visitor-feedback-title" className="text-lg font-semibold">Saved visitor feedback</h2><p className="text-sm text-muted-foreground">Visitor-submitted questions are not verified transcripts. Creating a FAQ copies the question into a private Library draft that remains after feedback expires or is deleted. It does not generate an answer or publish or approve a document.</p><div className="flex flex-wrap items-end gap-3"><label className="grid gap-1 text-sm"><span>Feedback status</span><select className={field} disabled={busy} value={filter} onChange={event => setFilter(event.target.value as Filter)}><option value="open">Open</option><option value="dismissed">Dismissed</option><option value="all">All</option></select></label><Button className="min-h-11" variant="outline" disabled={busy} onClick={() => loadList()}>{loaded ? 'Reload visitor feedback' : 'Load visitor feedback'}</Button></div>
      {data && <><p className="text-xs text-muted-foreground">Showing {loadedFilter} · Page {data.page} · Up to 20 reports per page</p>{!data.rows.length && <p className="text-sm">No saved visitor feedback in this view.</p>}{data.rows.map(row => <article key={row.id} aria-label="Visitor feedback" className="min-w-0 space-y-3 rounded-xl border bg-card p-4"><p className="whitespace-pre-wrap break-words text-sm font-medium">{row.question}</p><p className="break-all text-xs text-muted-foreground">{row.siteOrigin} · {row.status === 'open' ? 'Open' : 'Dismissed'}</p><p className="text-xs text-muted-foreground">Consent: {new Date(row.consentedAt).toLocaleString()} · Expires: {new Date(row.expiresAt).toLocaleString()}</p>{row.faq && <p className="text-sm">FAQ: {row.faq.status}{row.faq.status !== 'unavailable' && <> · <Link className="inline-flex min-h-11 items-center underline" href={row.faq.knowledgeUrl}>Open FAQ</Link></>}</p>}<div className="flex flex-wrap gap-2">{!row.faq && <Button className="min-h-11" variant="outline" disabled={busy} onClick={() => createFaq(row)}>Create FAQ draft</Button>}<Button className="min-h-11" variant="outline" disabled={busy} onClick={() => change(row, row.status === 'open' ? 'dismiss' : 'reopen')}>{row.status === 'open' ? 'Dismiss feedback' : 'Reopen feedback'}</Button><Button className="min-h-11" variant="outline" disabled={busy} onClick={() => { setDeleteId(row.id); setError('') }}>Delete feedback</Button></div>{deleteId === row.id && <div role="alert" className="space-y-3 rounded-md border p-3 text-sm"><p>Delete this saved question permanently? FAQ drafts remain in Library.</p><div className="flex flex-wrap gap-2"><Button className="min-h-11" variant="outline" disabled={busy} onClick={() => setDeleteId(null)}>Cancel deletion</Button><Button className="min-h-11" variant="destructive" disabled={busy} onClick={() => change(row, 'delete')}>Confirm deletion</Button></div></div>}</article>)}<div className="flex flex-wrap gap-2"><Button className="min-h-11" variant="outline" disabled={busy || data.page <= 1} onClick={() => loadList(loadedFilter, data.page - 1)}>Previous feedback page</Button><Button className="min-h-11" variant="outline" disabled={busy || !data.hasMore} onClick={() => loadList(loadedFilter, data.page + 1)}>Next feedback page</Button></div></>}
    </section>
    {busy && <p role="status" className="text-sm">Working on visitor feedback…</p>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}{notice && <p role="status" className="text-sm">{notice}</p>}{savedFaq && <p className="text-sm">{savedFaq.available ? <Link className="inline-flex min-h-11 items-center font-medium underline" href={savedFaq.knowledgeUrl}>Open saved FAQ draft</Link> : 'The original FAQ is unavailable. No replacement was created.'}</p>}
  </div>
}
