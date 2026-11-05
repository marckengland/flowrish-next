'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input, inputBaseClass } from '@/components/ui/input'
import { SAVED_FOLLOW_UP_VIEW_LIMIT, savedFollowUpViewCreateSchema, savedFollowUpViewUpdateSchema, savedFollowUpViewDeleteSchema, savedFollowUpViewSchema, type SavedFollowUpView } from '@/lib/saved-follow-up-views'
import { followUpHeaders, type FollowUpContext } from '@/lib/follow-up-access'
import { followUpData, FollowUpClientError } from '@/lib/follow-up-client'
import type { SavedFollowUpSettings } from '@/lib/saved-follow-up-views'

export interface SavedFollowUpViewsProps {
  context: FollowUpContext
  settings: SavedFollowUpSettings
  disabled: boolean
  onApply: (settings: SavedFollowUpSettings) => void
  onAccessLost: (reason: unknown) => void
}
type CreateInput = z.infer<typeof savedFollowUpViewCreateSchema>

export function SavedFollowUpViews(props: SavedFollowUpViewsProps) {
  return <PersonalViews key={`${props.context.organizationId}:${props.context.userId}`} {...props} />
}

function PersonalViews(props: SavedFollowUpViewsProps) {
  const { organizationId, userId } = props.context
  const lost = useRef(props.onAccessLost); lost.current = props.onAccessLost
  const [views, setViews] = useState<SavedFollowUpView[]>([])
  const [selected, setSelected] = useState<SavedFollowUpView | null>(null)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [denied, setDenied] = useState(false), [conflicted, setConflicted] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pendingCreate, setPendingCreate] = useState<CreateInput | null>(null)
  const pending = useRef<CreateInput | null>(null), active = useRef(false), writing = useRef(false), sequence = useRef(0)
  const inputId = useId(), selectId = useId(), titleId = useId()

  const request = useCallback(async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json', ...followUpHeaders({ organizationId, userId }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return (await followUpData<unknown>(response, { organizationId, userId })).data
  }, [organizationId, userId])

  const fail = useCallback((reason: unknown) => {
    if (!active.current) return
    setError(reason instanceof z.ZodError ? 'Choose a name of 1–80 characters and valid follow-up settings.' : reason instanceof FollowUpClientError ? reason.message : 'Could not confirm the saved-view request. Refresh views before continuing.')
    if (reason instanceof FollowUpClientError && ([401, 403].includes(reason.status) || /CONTEXT|WORKSPACE/.test(reason.code))) { setViews([]); setSelected(null); setName(''); setNotice(''); pending.current = null; setPendingCreate(null); setDenied(true); lost.current(reason) }
  }, [])

  const load = useCallback(async (background = false) => {
    const current = ++sequence.current
    if (!background) setLoading(true)
    try {
      const rows = z.array(savedFollowUpViewSchema).max(SAVED_FOLLOW_UP_VIEW_LIMIT).parse(await request('/api/follow-up-views'))
      if (!active.current || current !== sequence.current) return
      setViews(rows); setDenied(false)
      const receipt = pending.current && rows.find(row => row.id === pending.current?.id && row.name === pending.current.name && JSON.stringify(row.settings) === JSON.stringify(pending.current.settings))
      if (receipt) { pending.current = null; setPendingCreate(null); setSelected(receipt); setName(receipt.name); setNotice('View saved.'); setError('') }
    } catch (reason) { if (current === sequence.current) fail(reason) }
    finally { if (active.current && current === sequence.current) setLoading(false) }
  }, [request, fail])

  useEffect(() => {
    active.current = true
    void load()
    const refresh = () => { if (!writing.current) void load(true) }
    window.addEventListener('focus', refresh)
    return () => { active.current = false; window.removeEventListener('focus', refresh) }
  }, [load])

  function select(view: SavedFollowUpView | null) {
    setSelected(view); setName(view?.name ?? ''); setConfirmDelete(false); setConflicted(false); setError(''); setNotice('')
  }
  async function change(method: 'POST' | 'PATCH' | 'DELETE', body: unknown) {
    if (writing.current || denied) return
    writing.current = true; ++sequence.current; setLoading(false); setBusy(true); setError(''); setNotice(''); setConfirmDelete(false)
    try {
      const input = method === 'POST' ? savedFollowUpViewCreateSchema.parse(body) : method === 'PATCH' ? savedFollowUpViewUpdateSchema.parse(body) : savedFollowUpViewDeleteSchema.parse(body)
      const data = await request(method === 'POST' ? '/api/follow-up-views' : `/api/follow-up-views/${selected!.id}`, method, input)
      if (!active.current) return
      if (method === 'DELETE') {
        z.object({ deleted: z.literal(true) }).strict().parse(data)
        setViews(current => current.filter(row => row.id !== selected!.id)); select(null); setNotice('Saved view deleted. Your inbox filters and drafts were kept.')
      } else {
        const view = savedFollowUpViewSchema.parse(data)
        const expected = input as { id?: string; name?: string; settings?: SavedFollowUpSettings; expectedRevision?: number }
        if (view.id !== (method === 'POST' ? expected.id : selected!.id) || (expected.name !== undefined && view.name !== expected.name) || (expected.settings !== undefined && JSON.stringify(view.settings) !== JSON.stringify(expected.settings)) || view.revision !== (method === 'POST' ? 1 : expected.expectedRevision! + 1)) throw new Error('Unconfirmed view receipt')
        setViews(current => [...current.filter(row => row.id !== view.id), view].sort((a, b) => a.name.localeCompare(b.name)))
        select(view); pending.current = null; setPendingCreate(null); setNotice(method === 'POST' ? 'View saved.' : 'Saved view updated.')
      }
    } catch (reason) {
      fail(reason)
      if (active.current && reason instanceof FollowUpClientError) {
        if (method === 'POST' && [400, 403, 409, 413].includes(reason.status)) { pending.current = null; setPendingCreate(null) }
        if (method !== 'POST' && [404, 409].includes(reason.status) && !/CONTEXT|WORKSPACE/.test(reason.code)) { setConflicted(true); void load() }
      }
    } finally { writing.current = false; if (active.current) setBusy(false) }
  }
  function create() {
    try {
      const input = savedFollowUpViewCreateSchema.parse({ id: crypto.randomUUID(), name, settings: props.settings })
      pending.current = input; setPendingCreate(input); void change('POST', input)
    } catch { setError('Choose a name of 1–80 characters and valid follow-up settings.') }
  }
  function apply() {
    if (!selected) return
    props.onApply(selected.settings)
    setError(''); setNotice('')
  }
  const stale = conflicted || !!selected && (!views.some(view => view.id === selected.id) || views.find(view => view.id === selected.id)?.revision !== selected.revision)
  const disabled = loading || busy || denied || props.disabled || !!pendingCreate
  return <section aria-labelledby={titleId} className="min-w-0 space-y-3 rounded-lg border bg-card p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 id={titleId} className="font-semibold">Saved follow-up views</h2><p className="text-sm text-muted-foreground">Personal to this business and account. Available on your other devices; refresh to load changes.</p></div><Button type="button" variant="outline" className="min-h-11" disabled={busy || loading || props.disabled} onClick={() => { setError(''); void load() }}>Refresh saved views</Button></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {denied && <Button type="button" variant="outline" className="min-h-11" onClick={() => window.location.reload()}>Reload Follow-ups</Button>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {loading && <p role="status" className="text-sm">Loading saved views…</p>}
    {!loading && !denied && views.length === 0 && <p className="text-sm text-muted-foreground">No saved views yet.</p>}
    {stale && <p className="text-sm">This view changed or was removed. Refresh and reload the selected view before continuing. Your draft name is kept.</p>}
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1 space-y-1"><label htmlFor={selectId} className="text-sm">Saved follow-up view</label><select id={selectId} value={selected?.id ?? ''} className={`${inputBaseClass} min-h-11 w-full`} disabled={loading || busy || denied || props.disabled || !!pendingCreate} onChange={event => select(views.find(view => view.id === event.target.value) ?? null)}><option value="">Choose a saved view</option>{views.map(view => <option key={view.id} value={view.id}>{view.name}</option>)}</select></div>
      <Button type="button" variant="outline" className="min-h-11" disabled={disabled || !selected || stale} onClick={apply}>Apply view</Button>
      {selected && <Button type="button" variant="outline" className="min-h-11" disabled={loading || busy || denied || props.disabled || !!pendingCreate} onClick={() => select(views.find(view => view.id === selected.id) ?? null)}>Reload selected view</Button>}
    </div>
    <div className="flex flex-wrap items-end gap-3"><div className="min-w-0 flex-1 space-y-1"><label htmlFor={inputId} className="text-sm">View name</label><Input id={inputId} value={name} maxLength={80} disabled={busy || denied || props.disabled || !!pendingCreate} onChange={event => { setName(event.target.value); setConfirmDelete(false) }} className="min-h-11" /></div><Button type="button" className="min-h-11" disabled={disabled || !name.trim() || views.length >= SAVED_FOLLOW_UP_VIEW_LIMIT} onClick={create}>Save as new view</Button></div>
    <p className="text-xs text-muted-foreground">{views.length}/{SAVED_FOLLOW_UP_VIEW_LIMIT} views. Saves the applied tab, search, source and due-reminder filter. Drafts are never saved in views. Applying uses your current follow-up permissions.</p>
    {selected && <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={disabled || stale || !name.trim()} onClick={() => { void change('PATCH', { expectedRevision: selected.revision, name }) }}>Rename view</Button><Button type="button" variant="outline" className="min-h-11" disabled={disabled || stale} onClick={() => { void change('PATCH', { expectedRevision: selected.revision, settings: props.settings }) }}>Replace saved settings</Button><Button type="button" variant="outline" className="min-h-11" disabled={disabled || stale} onClick={() => setConfirmDelete(true)}>Delete saved view</Button></div>}
    {confirmDelete && selected && <div className="space-y-2 rounded-md border p-3"><p>Delete “{selected.name}”? Your follow-ups, filters and drafts will be kept.</p><div className="flex flex-wrap gap-2"><Button type="button" className="min-h-11" disabled={disabled || stale} onClick={() => { void change('DELETE', { expectedRevision: selected.revision }) }}>Confirm delete saved view</Button><Button type="button" variant="outline" disabled={busy} onClick={() => setConfirmDelete(false)}>Cancel deletion</Button></div></div>}
    {pendingCreate && !busy && <div className="space-y-2"><p className="text-sm">The save outcome is uncertain. Retry the same name and settings without creating a duplicate.</p><Button type="button" variant="outline" className="min-h-11" disabled={denied || props.disabled} onClick={() => { void change('POST', pendingCreate) }}>Retry save</Button></div>}
  </section>
}
