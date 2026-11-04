'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input, inputBaseClass } from '@/components/ui/input'
import { SAVED_LEAD_VIEW_LIMIT, SAVED_VIEW_USER_HEADER, savedLeadFiltersSchema, savedLeadViewCreateSchema, savedLeadViewSchema, unavailableViewFilters, type SavedLeadView } from '@/lib/saved-lead-views'
import { useFiltersStore } from '@/stores/filters'
import type { FilterOption } from './lead-filters'

export interface SavedLeadViewsProps {
  organizationId: string
  userId: string
  pipelineId?: string
  stages: readonly FilterOption[]
  assignees: readonly FilterOption[]
  filtersReady: boolean
}
type CreateInput = z.infer<typeof savedLeadViewCreateSchema>
class ViewRequestError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message) }
}

export function SavedLeadViews(props: SavedLeadViewsProps) {
  return <PersonalViews key={`${props.organizationId}:${props.userId}`} {...props} />
}

function PersonalViews(props: SavedLeadViewsProps) {
  const { organizationId, userId, filtersReady } = props
  const [views, setViews] = useState<SavedLeadView[]>([])
  const [selected, setSelected] = useState<SavedLeadView | null>(null)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [denied, setDenied] = useState(false), [conflicted, setConflicted] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pendingCreate, setPendingCreate] = useState<CreateInput | null>(null)
  const pending = useRef<CreateInput | null>(null), active = useRef(false), writing = useRef(false), sequence = useRef(0)
  const inputId = useId(), selectId = useId(), titleId = useId()

  const request = useCallback(async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-flowrish-workspace': organizationId, [SAVED_VIEW_USER_HEADER]: userId }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const value = await response.json()
    if (!response.ok) throw new ViewRequestError(value?.error?.message ?? 'Saved views are unavailable. Please refresh and try again.', response.status, value?.error?.code)
    if (value?.scope?.organizationId !== organizationId || value?.scope?.userId !== userId) throw new ViewRequestError('The business or account changed. Reload before continuing.', 403)
    return value.data as unknown
  }, [organizationId, userId])

  const fail = useCallback((reason: unknown) => {
    if (!active.current) return
    setError(reason instanceof ViewRequestError ? reason.message : 'Could not confirm the saved-view request. Refresh views before continuing.')
    if (reason instanceof ViewRequestError && ([401, 403].includes(reason.status) || reason.code === 'SAVED_VIEW_CONTEXT_CHANGED')) { setViews([]); setSelected(null); setName(''); setNotice(''); pending.current = null; setPendingCreate(null); setDenied(true) }
  }, [])

  const load = useCallback(async (background = false) => {
    const current = ++sequence.current
    if (!background) setLoading(true)
    try {
      const rows = z.array(savedLeadViewSchema).max(SAVED_LEAD_VIEW_LIMIT).parse(await request('/api/lead-views'))
      if (!active.current || current !== sequence.current) return
      setViews(rows); setDenied(false)
      const receipt = pending.current && rows.find(row => row.id === pending.current?.id)
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

  function select(view: SavedLeadView | null) {
    setSelected(view); setName(view?.name ?? ''); setConfirmDelete(false); setConflicted(false); setError(''); setNotice('')
  }
  async function change(method: 'POST' | 'PATCH' | 'DELETE', body: unknown) {
    if (writing.current || denied) return
    writing.current = true; ++sequence.current; setLoading(false); setBusy(true); setError(''); setNotice(''); setConfirmDelete(false)
    try {
      const data = await request(method === 'POST' ? '/api/lead-views' : `/api/lead-views/${selected!.id}`, method, body)
      if (!active.current) return
      if (method === 'DELETE') {
        z.object({ deleted: z.literal(true) }).strict().parse(data)
        setViews(current => current.filter(row => row.id !== selected!.id)); select(null); setNotice('Saved view deleted. Your lead filters were kept.')
      } else {
        const view = savedLeadViewSchema.parse(data)
        setViews(current => [...current.filter(row => row.id !== view.id), view].sort((a, b) => a.name.localeCompare(b.name)))
        select(view); pending.current = null; setPendingCreate(null); setNotice(method === 'POST' ? 'View saved.' : 'Saved view updated.')
      }
    } catch (reason) {
      fail(reason)
      if (active.current && reason instanceof ViewRequestError) {
        if (method === 'POST' && [400, 403, 409, 413].includes(reason.status)) { pending.current = null; setPendingCreate(null) }
        if (method !== 'POST' && [404, 409].includes(reason.status) && reason.code !== 'SAVED_VIEW_CONTEXT_CHANGED') { setConflicted(true); void load() }
      }
    } finally { writing.current = false; if (active.current) setBusy(false) }
  }
  function create() {
    try {
      const input = savedLeadViewCreateSchema.parse({ id: crypto.randomUUID(), name, filters: useFiltersStore.getState().leads })
      pending.current = input; setPendingCreate(input); void change('POST', input)
    } catch { setError('Choose a name of 1–80 characters and valid lead filters.') }
  }
  function apply() {
    if (!selected) return
    const missing = unavailableViewFilters(selected.filters, props)
    if (missing.length) { setError(`This view uses an unavailable ${missing.join(', ')}. Keep your current filters, or replace this view with valid filters.`); return }
    useFiltersStore.getState().setLeadFilters(savedLeadFiltersSchema.parse(selected.filters))
    setError(''); setNotice(`Applied ${selected.name}.`)
  }
  const stale = conflicted || !!selected && (!views.some(view => view.id === selected.id) || views.find(view => view.id === selected.id)?.revision !== selected.revision)
  const disabled = loading || busy || denied || !filtersReady || !!pendingCreate
  return <section aria-labelledby={titleId} className="min-w-0 space-y-3 rounded-lg border bg-card p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 id={titleId} className="font-semibold">Saved lead views</h2><p className="text-sm text-muted-foreground">Personal to this business and account. Available on your other devices; refresh to load changes.</p></div><Button type="button" variant="outline" className="min-h-11" disabled={busy || loading} onClick={() => { setError(''); void load() }}>Refresh saved views</Button></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {denied && <Button type="button" variant="outline" className="min-h-11" onClick={() => window.location.reload()}>Reload Leads</Button>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {loading && <p role="status" className="text-sm">Loading saved views…</p>}
    {!loading && !denied && views.length === 0 && <p className="text-sm text-muted-foreground">No saved views yet.</p>}
    {stale && <p className="text-sm">This view changed or was removed. Refresh and reload the selected view before continuing. Your draft name is kept.</p>}
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1 space-y-1"><label htmlFor={selectId} className="text-sm">Saved lead view</label><select id={selectId} value={selected?.id ?? ''} className={`${inputBaseClass} min-h-11 w-full`} disabled={loading || busy || denied || !!pendingCreate} onChange={event => select(views.find(view => view.id === event.target.value) ?? null)}><option value="">Choose a saved view</option>{views.map(view => <option key={view.id} value={view.id}>{view.name}</option>)}</select></div>
      <Button type="button" variant="outline" className="min-h-11" disabled={disabled || !selected || stale} onClick={apply}>Apply view</Button>
      {selected && <Button type="button" variant="outline" className="min-h-11" disabled={loading || busy || denied || !!pendingCreate} onClick={() => select(views.find(view => view.id === selected.id) ?? null)}>Reload selected view</Button>}
    </div>
    <div className="flex flex-wrap items-end gap-3"><div className="min-w-0 flex-1 space-y-1"><label htmlFor={inputId} className="text-sm">View name</label><Input id={inputId} value={name} maxLength={80} disabled={busy || denied || !!pendingCreate} onChange={event => { setName(event.target.value); setConfirmDelete(false) }} className="min-h-11" /></div><Button type="button" className="min-h-11" disabled={disabled || !name.trim() || views.length >= SAVED_LEAD_VIEW_LIMIT} onClick={create}>Save as new view</Button></div>
    <p className="text-xs text-muted-foreground">{views.length}/{SAVED_LEAD_VIEW_LIMIT} views. Saves filters only; applying a view keeps your existing lead permissions.</p>
    {selected && <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={disabled || stale || !name.trim()} onClick={() => { void change('PATCH', { expectedRevision: selected.revision, name }) }}>Rename view</Button><Button type="button" variant="outline" className="min-h-11" disabled={disabled || stale} onClick={() => { void change('PATCH', { expectedRevision: selected.revision, filters: useFiltersStore.getState().leads }) }}>Replace saved filters</Button><Button type="button" variant="outline" className="min-h-11" disabled={disabled || stale} onClick={() => setConfirmDelete(true)}>Delete saved view</Button></div>}
    {confirmDelete && selected && <div className="space-y-2 rounded-md border p-3"><p>Delete “{selected.name}”? Your leads and current filters will be kept.</p><div className="flex flex-wrap gap-2"><Button type="button" className="min-h-11" disabled={disabled || stale} onClick={() => { void change('DELETE', { expectedRevision: selected.revision }) }}>Confirm delete saved view</Button><Button type="button" variant="outline" disabled={busy} onClick={() => setConfirmDelete(false)}>Cancel deletion</Button></div></div>}
    {pendingCreate && !busy && <div className="space-y-2"><p className="text-sm">The save outcome is uncertain. Retry the same name and filters without creating a duplicate.</p><Button type="button" variant="outline" className="min-h-11" disabled={denied} onClick={() => { void change('POST', pendingCreate) }}>Retry save</Button></div>}
  </section>
}
