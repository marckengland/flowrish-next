'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { CallbackOutcomeTracker } from './callback-outcomes'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { handoffOptionsSchema, handoffDraftSchema, handoffPreviewSchema, handoffReceiptSchema, type HandoffOptions, type HandoffPreview, type HandoffReceipt } from '@/lib/callback-handoff'

const field = 'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
class RequestError extends Error { constructor(readonly status: number) { super('Request unavailable') } }
export function CallbackHandoff({ callbackId, disabled = false, onCallbackClosed }: { callbackId: string; disabled?: boolean; onCallbackClosed?: () => void }) {
  const [options, setOptions] = useState<HandoffOptions | null>(null)
  const [receipt, setReceipt] = useState<HandoffReceipt | null>(null)
  const [preview, setPreview] = useState<HandoffPreview | null>(null)
  const [approved, setApproved] = useState(false)
  const [target, setTarget] = useState(''), [contact, setContact] = useState(''), [firstName, setFirst] = useState(''), [lastName, setLast] = useState('')
  const [stage, setStage] = useState(''), [owner, setOwner] = useState(''), [deadline, setDeadline] = useState(''), [duplicate, setDuplicate] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const lock = useRef(false), mounted = useRef(true), controller = useRef<AbortController | null>(null)
  const base = `/api/admin/website-receptionist/callbacks/${callbackId}/handoff`
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort() } }, [])
  function invalidate() { setPreview(null); setApproved(false); setError('') }
  function edit(action: () => void) { invalidate(); action() }
  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (lock.current || disabled) return
    lock.current = true; setBusy(true); setError(''); controller.current = new AbortController()
    try { await action(controller.current.signal) }
    catch (cause) {
      if (mounted.current && !controller.current.signal.aborted) {
        if (cause instanceof RequestError && cause.status === 409) { setPreview(null); setApproved(false) }
        setError(cause instanceof RequestError && cause.status === 409 ? 'The handoff changed. Reload handoff choices, then review again. Your entries are preserved.' : 'Could not confirm the handoff. Check your choices and future deadline, or reload handoff choices to check its status. Your entries are preserved.')
      }
    } finally { lock.current = false; if (mounted.current) setBusy(false) }
  }
  async function request(path: string, signal: AbortSignal, body?: unknown) {
    const response = await fetch(path, { signal, cache: 'no-store', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
    if (!response.ok) throw new RequestError(response.status)
    return response.json() as Promise<unknown>
  }
  function load() { void run(async signal => {
    const next = z.object({ data: handoffOptionsSchema }).strict().parse(await request(base, signal)).data
    if (!mounted.current) return
    if ((next.callback && next.callback.id !== callbackId) || (next.receipt && next.receipt.callbackId !== callbackId) || (!next.callback && !next.receipt)) throw new Error('Unexpected callback response')
    if (!options && next.callback) { const parts = next.callback.fullName.trim().split(/\s+/); setFirst(parts.slice(0, -1).join(' ') || parts[0]); setLast(parts.length > 1 ? parts.at(-1)! : '') }
    invalidate(); setOptions(next); setReceipt(next.receipt)
  }) }
  function review(event: React.FormEvent) {
    event.preventDefault()
    if (!options?.callback) return
    let draft
    try { draft = handoffDraftSchema.parse({ expectedUpdatedAt: options.callback.updatedAt, target: target === 'new' ? { mode: 'new', firstName, lastName, stageId: stage, contactId: contact || null } : { mode: 'lead', leadId: target }, assigneeId: owner, dueDate: new Date(deadline).toISOString(), acknowledgeDuplicate: duplicate }) }
    catch { setError('Choose a destination, owner, and valid future deadline. New leads require first name, last name, and stage.'); return }
    invalidate()
    void run(async signal => { const next = z.object({ data: handoffPreviewSchema }).strict().parse(await request(`${base}/preview`, signal, draft)).data; if (JSON.stringify(next.draft) !== JSON.stringify(draft)) throw new Error('Unexpected preview'); if (mounted.current) setPreview(next) })
  }
  function confirm() {
    if (!preview || !approved) return
    const reviewed = preview
    void run(async signal => {
      const next = z.object({ data: handoffReceiptSchema }).strict().parse(await request(base, signal, { draft: reviewed.draft, previewVersion: reviewed.version, confirmed: true })).data
      if (next.callbackId !== callbackId) throw new Error('Unexpected handoff receipt')
      if (mounted.current) { setReceipt(next); setPreview(null); setApproved(false) }
    })
  }
  return <section aria-label="CRM callback handoff" className="space-y-3 border-t pt-3">
    <Button type="button" variant="outline" className="min-h-11 whitespace-normal" disabled={disabled || busy} onClick={load}>{options ? 'Reload handoff choices' : 'Prepare CRM handoff'}</Button>
    {busy && <p role="status">Working on handoff…</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {options?.callback && <div className="space-y-1 text-sm"><p className="break-words font-medium">{options.callback.fullName} · {options.callback.phone}</p><p className="whitespace-pre-wrap break-words">{options.callback.reason}</p><p className="text-xs text-muted-foreground">Consent: {new Date(options.callback.consentedAt).toLocaleString()}</p></div>}
    {receipt ? <div className="space-y-2 text-sm"><p role="status">This callback has already been handed to CRM.</p><p>{new Date(receipt.createdAt).toLocaleString()}</p><div className="flex flex-wrap gap-4">{receipt.leadAvailable ? <Link className="underline" href={`/leads/${receipt.leadId}`}>Open lead</Link> : <p>Original lead is unavailable.</p>}{receipt.taskAvailable ? <Link className="underline" href={`/tasks/${receipt.taskId}`}>Open callback task</Link> : <p>Original task is unavailable. A retry will not recreate it.</p>}</div><CallbackOutcomeTracker callbackId={callbackId} onSaved={action => { if (action === 'close') onCallbackClosed?.() }} /></div> : options?.callback && <>
      <p className="text-sm text-muted-foreground">Choose a matching lead, or explicitly create a new lead. Contact matches can be linked to a new lead; tasks require a lead. Existing CRM details and callback review status stay unchanged.</p>
      {options.contacts.length > 0 && <ul aria-label="Matching contacts" className="list-inside list-disc text-sm">{options.contacts.map(row => <li key={row.id} className="break-words">{row.label}{row.leadIds.length ? ' · Linked active leads are included in the destination choices.' : ' · No active linked lead.'}</li>)}</ul>}
      {!options.leads.length && !options.contacts.length && <p className="text-sm">No matching international phone numbers found.</p>}
      {options.matchesTruncated && <p className="text-sm">More than 20 matches exist. Only the first matches are shown. Review CRM records before creating another lead.</p>}
      {options.choicesTruncated && <p className="text-sm">Only the first 200 owners and stages are shown. Ask an administrator if your choice is missing.</p>}
      <form onSubmit={review} className="space-y-3"><fieldset disabled={busy || disabled} className="min-w-0 space-y-3">
        <label className="block space-y-1"><span>CRM destination</span><select className={field} value={target} required onChange={event => edit(() => setTarget(event.target.value))}><option value="">Choose a destination</option>{options.leads.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}<option value="new">Create a new lead</option></select></label>
        {target === 'new' && <div className="space-y-3 rounded-md border p-3">
          <label className="block space-y-1"><span>New lead first name</span><Input required maxLength={120} value={firstName} onChange={event => edit(() => setFirst(event.target.value))} /></label>
          <label className="block space-y-1"><span>New lead last name</span><Input required maxLength={120} value={lastName} onChange={event => edit(() => setLast(event.target.value))} /></label>
          <label className="block space-y-1"><span>New lead stage</span><select className={field} required value={stage} onChange={event => edit(() => setStage(event.target.value))}><option value="">Choose an open stage</option>{options.stages.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>
          <label className="block space-y-1"><span>Link matching contact</span><select className={field} value={contact} onChange={event => edit(() => setContact(event.target.value))}><option value="">Do not link a contact</option>{options.contacts.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>
          {(!!options.leads.length || !!options.contacts.length || options.matchesTruncated) && <label className="flex min-h-11 items-start gap-2"><input type="checkbox" required checked={duplicate} onChange={event => edit(() => setDuplicate(event.target.checked))} />I reviewed existing matches and approve creating another lead.</label>}
        </div>}
        <label className="block space-y-1"><span>Callback owner</span><select className={field} required value={owner} onChange={event => edit(() => setOwner(event.target.value))}><option value="">Choose an organization member</option>{options.members.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>
        <label className="block space-y-1"><span>Callback deadline</span><Input type="datetime-local" required aria-describedby={`deadline-help-${callbackId}`} value={deadline} onChange={event => edit(() => setDeadline(event.target.value))} /></label><p id={`deadline-help-${callbackId}`} className="text-xs text-muted-foreground">Your local time zone. The preview shows the exact deadline.</p>
        <Button type="submit" variant="outline" className="min-h-11">Preview callback task</Button>
      </fieldset></form>
      {preview && <div aria-label="CRM handoff preview" className="space-y-3 rounded-md border p-3 text-sm"><h4 className="font-semibold">Review CRM handoff</h4><p className="break-words">Destination: {preview.targetLabel}</p>{preview.contactLabel && <p className="break-words">Link contact: {preview.contactLabel}</p>}<p>Owner: {preview.assigneeName}</p><p>Deadline: {new Date(preview.draft.dueDate).toLocaleString()} ({Intl.DateTimeFormat().resolvedOptions().timeZone})</p><p>Priority: Medium</p><p className="break-words">Task: {preview.taskTitle}</p><p className="whitespace-pre-wrap break-words">{preview.taskDescription}</p><p>This copies the shown visitor details to CRM. Deleting the callback later will not delete the lead or task. No call or message will be sent.</p><label className="flex min-h-11 items-start gap-2"><input type="checkbox" checked={approved} disabled={busy || disabled} onChange={event => setApproved(event.target.checked)} />I approve creating this callback task and any new lead shown above.</label><Button type="button" className="min-h-11" disabled={busy || disabled || !approved} onClick={confirm}>Confirm CRM handoff</Button></div>}
    </>}
  </section>
}

export function CallbackHandoffSource() {
  const [callbackId, setCallbackId] = useState<string | null>(null)
  useEffect(() => { const parsed = z.string().uuid().safeParse(new URL(window.location.href).searchParams.get('callback')); if (parsed.success) setCallbackId(parsed.data) }, [])
  return callbackId ? <div className="space-y-2 rounded-md border p-3"><h3 className="font-semibold">Source callback handoff</h3><CallbackHandoff callbackId={callbackId} /></div> : null
}
