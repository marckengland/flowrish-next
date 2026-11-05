'use client'
import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { inputBaseClass } from '@/components/ui/input'
import { BULK_USER_HEADER, bulkLeadOptionsSchema, bulkLeadPreviewInput, bulkLeadResponse, type BulkLeadPreview, type BulkLeadSelected } from '@/lib/bulk-lead-updates'
import { leadStatusEnum } from '@/lib/validators/leads'

interface Props { organizationId: string; userId: string; selection: BulkLeadSelected; contextKey: string; onApplied: () => void }
class BulkError extends Error { constructor(public status: number, public code: string, message: string) { super(message) } }
export function BulkLeadControls({ organizationId, userId, selection, contextKey, onApplied }: Props) {
  const [field, setField] = useState('leadStatus'), [value, setValue] = useState('QUALIFIED')
  const [owners, setOwners] = useState<Array<{ id: string; label: string }>>([]), [truncated, setTruncated] = useState(false), [loaded, setLoaded] = useState(false)
  const [review, setReview] = useState<{ preview: BulkLeadPreview; context: string } | null>(null)
  const [confirmed, setConfirmed] = useState(false), [uncertain, setUncertain] = useState(false), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [denied, setDenied] = useState(false)
  const alive = useRef(false), writing = useRef(false), current = useRef(''), sequence = useRef(0)
  const context = `${contextKey}:${JSON.stringify(selection)}`, selected = selection.length > 0
  current.current = context
  const title = useId(), fieldId = useId(), valueId = useId(), confirmId = useId()
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { if (!uncertain) { setReview(null); setConfirmed(false) } }, [context, uncertain])
  async function request(path: string, body?: unknown) {
    const response = await fetch(`/api/leads/bulk${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-flowrish-workspace': organizationId, [BULK_USER_HEADER]: userId }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const result = await response.json()
    if (!response.ok) throw new BulkError(response.status, result?.error?.code ?? '', result?.error?.message ?? 'Bulk update unavailable.')
    if (result?.scope?.organizationId !== organizationId || result?.scope?.userId !== userId) throw new BulkError(409, 'BULK_CONTEXT_CHANGED', 'The account or business changed. Reload before continuing.')
    return result.data as unknown
  }
  function failure(reason: unknown) {
    setError(reason instanceof BulkError ? reason.message : 'Could not confirm the result. Retry the same request before making another update.')
    if (reason instanceof BulkError && ([401, 403].includes(reason.status) || reason.code === 'BULK_CONTEXT_CHANGED')) { setDenied(true); setOwners([]); setReview(null) }
  }
  useEffect(() => {
    if (!selected || loaded || denied) return
    let active = true
    void request('').then(data => { const options = bulkLeadOptionsSchema.parse(data); if (active) { setOwners(options.owners); setTruncated(options.ownersTruncated); setLoaded(true) } }).catch(reason => { if (active) failure(reason) })
    return () => { active = false }
    // Scope changes remount this control; selection only triggers the lazy read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, loaded, denied])
  const preview = review && (review.context === context || uncertain) ? review.preview : null
  function edit(nextField: string, nextValue: string) { setField(nextField); setValue(nextValue); setReview(null); setConfirmed(false); setError(''); setNotice('') }
  function complete(updated: number, unchanged: number) { setReview(null); setUncertain(false); setConfirmed(false); setError(''); setNotice(`Updated ${updated} ${updated === 1 ? 'lead' : 'leads'}; ${unchanged} unchanged.`); onApplied() }
  async function prepare() {
    if (writing.current || uncertain || denied || !selected) return
    const startedContext = context, seq = ++sequence.current
    writing.current = true; setBusy(true); setError(''); setNotice(''); setReview(null); setConfirmed(false)
    try {
      const input = bulkLeadPreviewInput.parse({ id: crypto.randomUUID(), leads: selection, change: { field, value } })
      const result = bulkLeadResponse.parse(await request('/preview', input))
      if (!alive.current || seq !== sequence.current || current.current !== startedContext) return
      if (result.id !== input.id) throw new Error('Unexpected preview')
      if (result.state === 'applied') complete(result.updated, result.unchanged)
      else setReview({ preview: result, context: startedContext })
    } catch (reason) { if (alive.current && current.current === startedContext) failure(reason) }
    finally { writing.current = false; if (alive.current) setBusy(false) }
  }
  async function apply() {
    if (writing.current || denied || !preview || (!confirmed && !uncertain)) return
    writing.current = true; setBusy(true); setError(''); setUncertain(true)
    try {
      const result = bulkLeadResponse.parse(await request('/apply', { id: preview.id, confirmed: true }))
      if (!alive.current) return
      if (result.state !== 'applied' || result.id !== preview.id) throw new Error('Unexpected receipt')
      complete(result.updated, result.unchanged)
    } catch (reason) {
      if (!alive.current) return
      failure(reason)
      if (reason instanceof BulkError && [400, 401, 403, 404, 409, 410, 413].includes(reason.status)) { setUncertain(false); setReview(null); setConfirmed(false) }
    } finally { writing.current = false; if (alive.current) setBusy(false) }
  }
  if (!selected && !preview && !error && !notice) return null
  return <section aria-labelledby={title} className="min-w-0 space-y-3 rounded-lg border bg-card p-4">
    <h2 id={title} className="font-semibold">Bulk lead update</h2>
    <p className="text-sm">{selection.length} selected on this page. Update one field; every lead must still match the preview.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {denied ? <Button variant="outline" onClick={() => window.location.reload()}>Reload Leads</Button> : <>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[160px] space-y-1"><label htmlFor={fieldId} className="block text-sm">Field to update</label><select id={fieldId} className={`${inputBaseClass} min-h-11`} disabled={busy || uncertain} value={field} onChange={e => edit(e.target.value, e.target.value === 'leadStatus' ? 'QUALIFIED' : '')}><option value="leadStatus">Lead status</option><option value="assignedUserId">Owner</option></select></div>
        <div className="min-w-[200px] flex-1 space-y-1"><label htmlFor={valueId} className="block text-sm">{field === 'leadStatus' ? 'New lead status' : 'New owner'}</label><select id={valueId} className={`${inputBaseClass} min-h-11 w-full`} disabled={busy || uncertain || (field === 'assignedUserId' && !loaded)} value={value} onChange={e => edit(field, e.target.value)}>{field === 'leadStatus' ? leadStatusEnum.options.map(status => <option key={status} value={status}>{status}</option>) : <><option value="">Choose an eligible owner</option>{owners.map(owner => <option key={owner.id} value={owner.id}>{owner.label}</option>)}</>}</select></div>
        <Button className="min-h-11" disabled={busy || uncertain || !selection.length || !value} onClick={() => void prepare()}>Preview changes</Button>
      </div>
      {truncated && <p className="text-sm">Showing the first 200 eligible owners. Ask an administrator if the required owner is missing.</p>}
      {preview && <div className="space-y-3">
        <p className="text-sm">Review {preview.rows.length} leads: {preview.rows.filter(row => row.changed).length} will change; {preview.rows.filter(row => !row.changed).length} unchanged. Preview expires {new Date(preview.expiresAt).toLocaleString()}.</p>
        <ul className="max-h-80 space-y-2 overflow-auto rounded border p-3" aria-label="Exact bulk changes">{preview.rows.map(row => <li key={row.id} className="break-words text-sm"><strong>{row.label || 'Unnamed lead'}</strong><span className="block text-xs text-muted-foreground">{row.id}</span>{row.before} → {row.after}{!row.changed && ' (unchanged)'}</li>)}</ul>
        {uncertain ? <><p className="text-sm">This request may already be applied. Retry the same confirmed request to retrieve its result. Do not start another batch.</p><Button className="min-h-11" disabled={busy} onClick={() => void apply()}>Retry confirmed request</Button></> : <><label htmlFor={confirmId} className="flex min-h-11 items-center gap-2 text-sm"><input id={confirmId} type="checkbox" className="size-5" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />I reviewed these exact changes</label><Button className="min-h-11" disabled={busy || !confirmed} onClick={() => void apply()}>Confirm bulk update</Button></>}
      </div>}
    </>}
  </section>
}
