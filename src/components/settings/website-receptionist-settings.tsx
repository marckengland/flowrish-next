'use client'

import { useEffect, useRef, useState } from 'react'
import { CallbackHandoff, CallbackHandoffSource } from './callback-handoff'
import { CallbackOutcomeQueue } from './callback-outcomes'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  websiteAdminSchema, websiteReceptionistSaveSchema, websiteCallbackListSchema,
  websiteCallbackRecordSchema, WEBSITE_REPLY_RESERVATION,
  type WebsiteReceptionistAdminData, type WebsiteCallbackList, type WebsiteCallbackRecord,
} from '@/lib/website-receptionist'

const endpoint = '/api/admin/website-receptionist'
const adminResponse = z.object({ data: websiteAdminSchema }).strict()
const callbackResponse = z.object({ data: websiteCallbackRecordSchema }).strict()
const listResponse = z.object({ data: websiteCallbackListSchema }).strict()
const deleteResponse = z.object({ data: z.object({ deleted: z.literal(true) }).strict() }).strict()
const fieldClass = 'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
type Filter = 'pending' | 'reviewed' | 'dismissed' | 'all'
type Draft = { enabled: boolean; origins: string; dailyMessageLimit: string; dailyTokenLimit: string; dailyCallbackLimit: string }
function draftFrom(data: WebsiteReceptionistAdminData): Draft {
  return {
    enabled: data.settings?.enabled ?? false,
    origins: data.settings?.allowedOrigins.join('\n') ?? '',
    dailyMessageLimit: String(data.settings?.dailyMessageLimit ?? 5),
    dailyTokenLimit: String(data.settings?.dailyTokenLimit ?? 20000),
    dailyCallbackLimit: String(data.settings?.dailyCallbackLimit ?? 10),
  }
}
class RequestError extends Error {
  constructor(readonly status: number) { super('Request failed.') }
}

export function WebsiteReceptionistSettings({ setupOnly = false, initialData, onDirtyChange, onBusyChange, onSaved }: { setupOnly?: boolean; initialData?: WebsiteReceptionistAdminData; onDirtyChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void; onSaved?: () => void } = {}): React.JSX.Element {
  const [data, setData] = useState<WebsiteReceptionistAdminData | null>(initialData ?? null)
  const [draft, setDraft] = useState<Draft | null>(initialData ? draftFrom(initialData) : null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [discard, setDiscard] = useState<'reload' | string | null>(null)
  const [filter, setFilter] = useState<Filter>('pending')
  const [loadedFilter, setLoadedFilter] = useState<Filter>('pending')
  const [list, setList] = useState<WebsiteCallbackList | null>(null)
  const [callbacksLoaded, setCallbacksLoaded] = useState(false)
  const [callbacksBusy, setCallbacksBusy] = useState(false)
  const [callbacksError, setCallbacksError] = useState('')
  const [callbacksNotice, setCallbacksNotice] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const configLock = useRef(false)
  const callbacksLock = useRef(false)
  const controllers = useRef(new Set<AbortController>())
  const mounted = useRef(true)
  const pendingSection = useRef<HTMLButtonElement | null>(null)
  const discardPrompt = useRef<HTMLDivElement | null>(null)
  const allowSectionNavigation = useRef(false)
  const dirty = Boolean(data && draft && JSON.stringify(draft) !== JSON.stringify(draftFrom(data)))

  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => { onBusyChange?.(busy) }, [busy, onBusyChange])

  useEffect(() => {
    mounted.current = true
    const active = controllers.current
    return () => { mounted.current = false; for (const controller of active) controller.abort(); active.clear() }
  }, [])

  useEffect(() => { if (discard) discardPrompt.current?.focus() }, [discard])

  useEffect(() => {
    if (!dirty || setupOnly) return
    function beforeUnload(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = '' }
    function navigation(event: MouseEvent) {
      if (allowSectionNavigation.current) return
      const sectionButton = event.target instanceof Element ? event.target.closest('nav[aria-label="Settings sections"] button') : null
      if (sectionButton instanceof HTMLButtonElement && !sectionButton.disabled && sectionButton.getAttribute('aria-current') !== 'page') {
        event.preventDefault()
        event.stopPropagation()
        pendingSection.current = sectionButton
        setDiscard('section')
        return
      }
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(anchor instanceof HTMLAnchorElement) || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || anchor.target === '_blank' || anchor.hasAttribute('download')) return
      if (anchor.href === window.location.href) return
      event.preventDefault()
      event.stopPropagation()
      setDiscard(anchor.href)
    }
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', navigation, true)
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', navigation, true) }
  }, [dirty, setupOnly])

  function begin() { const controller = new AbortController(); controllers.current.add(controller); return controller }
  function active(controller: AbortController) { return mounted.current && !controller.signal.aborted }
  async function request(path: string, controller: AbortController, init?: RequestInit) {
    const response = await fetch(path, { ...init, signal: controller.signal, cache: 'no-store' })
    if (!response.ok) throw new RequestError(response.status)
    return response.json() as Promise<unknown>
  }
  function edit<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft(previous => previous ? { ...previous, [key]: value } : previous)
    setNotice('')
  }
  async function load() {
    if (configLock.current) return
    configLock.current = true
    setBusy(true); setError(''); setNotice(''); setDiscard(null)
    const controller = begin()
    try {
      const next = adminResponse.parse(await request(endpoint, controller)).data
      if (!active(controller)) return
      setData(next); setDraft(draftFrom(next)); setAcknowledged(false)
    } catch {
      if (active(controller)) setError('Could not load website receptionist settings. Try loading again.')
    } finally {
      controllers.current.delete(controller)
      configLock.current = false
      if (active(controller)) setBusy(false)
    }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!data || !draft || configLock.current) return
    const parsed = websiteReceptionistSaveSchema.safeParse({
      enabled: draft.enabled, allowedOrigins: draft.origins.split('\n').map(value => value.trim()).filter(Boolean),
      dailyMessageLimit: Number(draft.dailyMessageLimit), dailyTokenLimit: Number(draft.dailyTokenLimit),
      dailyCallbackLimit: Number(draft.dailyCallbackLimit), expectedUpdatedAt: data.settings?.updatedAt ?? null, acknowledged,
    })
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Check the website settings.'); return }
    configLock.current = true
    setBusy(true); setError(''); setNotice('')
    const controller = begin()
    try {
      const next = adminResponse.parse(await request(endpoint, controller, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed.data),
      })).data
      if (!active(controller)) return
      setData(next); setDraft(draftFrom(next)); setAcknowledged(false)
      setNotice('Website receptionist settings saved.'); onSaved?.()
    } catch (cause) {
      if (active(controller)) setError(cause instanceof RequestError && cause.status === 409
        ? 'Website settings changed elsewhere. Your edits are preserved. Reload settings to use the latest version; reloading replaces your edits.'
        : 'Could not save website receptionist settings. Your edits are preserved. Try again.')
    } finally {
      controllers.current.delete(controller)
      configLock.current = false
      if (active(controller)) setBusy(false)
    }
  }
  async function fetchList(controller: AbortController, status: Filter, page: number): Promise<WebsiteCallbackList> {
    const next = listResponse.parse(await request(`${endpoint}/callbacks?status=${status}&page=${page}`, controller)).data
    if (next.page !== page) throw new Error('Unexpected page.')
    if (!next.callbacks.length && page > 1) return fetchList(controller, status, page - 1)
    return next
  }
  async function loadCallbacks(status = filter, page = 1) {
    if (callbacksLock.current) return
    callbacksLock.current = true
    setCallbacksBusy(true); setCallbacksError(''); setCallbacksNotice(''); setDeleteId(null)
    const controller = begin()
    try {
      const next = await fetchList(controller, status, page)
      if (!active(controller)) return
      setList(next); setLoadedFilter(status); setCallbacksLoaded(true)
    } catch {
      if (active(controller)) { setList(null); setCallbacksError('Could not load callback requests. Try loading again.') }
    } finally {
      controllers.current.delete(controller)
      callbacksLock.current = false
      if (active(controller)) setCallbacksBusy(false)
    }
  }
  async function changeCallback(record: WebsiteCallbackRecord, action: 'review' | 'dismiss' | 'delete') {
    if (callbacksLock.current || !list || (action === 'delete' && deleteId !== record.id)) return
    callbacksLock.current = true
    setCallbacksBusy(true); setCallbacksError(''); setCallbacksNotice('')
    const controller = begin()
    let changed = false
    try {
      try {
        const body = await request(`${endpoint}/callbacks/${record.id}`, controller, action === 'delete'
          ? { method: 'DELETE' }
          : { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, expectedUpdatedAt: record.updatedAt }) })
        if (action === 'delete') deleteResponse.parse(body)
        else {
          const updated = callbackResponse.parse(body).data
          if (updated.id !== record.id || updated.status !== (action === 'review' ? 'reviewed' : 'dismissed')) throw new Error('Unexpected callback.')
        }
      } catch (cause) {
        if (!(action === 'delete' && cause instanceof RequestError && cause.status === 404)) throw cause
      }
      if (!active(controller)) return
      changed = true
      setCallbacksNotice(action === 'delete' ? 'Callback request deleted.' : action === 'review' ? 'Callback marked reviewed.' : 'Callback dismissed.')
      setDeleteId(null)
      const next = await fetchList(controller, loadedFilter, list.page)
      if (active(controller)) setList(next)
    } catch (cause) {
      if (!active(controller)) return
      if (changed) {
        setList(null)
        setCallbacksError('The change was saved, but callback requests could not be refreshed. Reload callback requests.')
      } else setCallbacksError(cause instanceof RequestError && cause.status === 409
        ? 'This callback changed elsewhere. Reload callback requests before trying again.'
        : 'Could not update the callback request. Reload callback requests and try again.')
    } finally {
      controllers.current.delete(controller)
      callbacksLock.current = false
      if (active(controller)) setCallbacksBusy(false)
    }
  }

  const ready = Boolean(data?.hasSavedBusiness && data.hasOrganizationAi && data.approvedDocuments > 0)
  const snippet = data?.settings ? `<script src="${typeof window !== 'undefined' ? window.location.origin : ''}/receptionist-widget.js" data-flowrish-receptionist="${data.settings.publicId}" defer></script>` : ''
  return (
    <section aria-label="Website receptionist" className="min-w-0 space-y-5">
      <Card>
        <CardHeader className="flex-col items-start gap-2">
          <CardTitle>Website receptionist</CardTitle>
          <p className="text-sm text-muted-foreground">Add a receptionist to your organization’s website. It answers from approved Library documents and collects callback requests for staff review.</p>
          <p className="text-xs text-muted-foreground">Off until you explicitly enable and save it. This setting is independent of your phone receptionist.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button type="button" variant="outline" className="min-h-11 whitespace-normal" disabled={busy} onClick={() => { if (dirty) setDiscard('reload'); else void load() }}>
            {data ? 'Reload website receptionist settings' : 'Load website receptionist settings'}
          </Button>
          {busy && <p className="text-sm text-muted-foreground">Working on website settings…</p>}
          {discard && <div role="alert" ref={discardPrompt} tabIndex={-1} className="space-y-3 rounded-md border p-3 text-sm">
            <p>{discard === 'reload' ? 'Reloading replaces your unsaved website receptionist edits.' : 'Discard unsaved website receptionist edits before leaving?'}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="min-h-11" onClick={() => setDiscard(null)}>Keep editing</Button>
              <Button type="button" className="min-h-11 whitespace-normal" onClick={() => {
                if (discard === 'reload') void load()
                else if (discard === 'section') {
                  setDiscard(null)
                  allowSectionNavigation.current = true
                  try { pendingSection.current?.click() } finally { allowSectionNavigation.current = false; pendingSection.current = null }
                } else { const destination = discard; setDiscard(null); window.location.assign(destination) }
              }}>{discard === 'reload' ? 'Discard edits and reload' : 'Discard edits and leave'}</Button>
            </div>
          </div>}
          {data && draft && <>
            <div className="space-y-1 text-sm" aria-label="Website receptionist readiness">
              <p>Saved business: {data.hasSavedBusiness ? 'Ready' : 'Required'}</p>
              <p>Organization AI: {data.hasOrganizationAi ? 'Ready' : 'Required'}</p>
              <p>Approved Library documents: {data.approvedDocuments}</p>
              <p className="text-muted-foreground">Enable requires a saved business, enabled organization AI, and at least one approved published Library document.</p>
              <p>Saved website setting: {data.settings?.enabled ? 'Enabled' : 'Off'}</p>
            </div>
            <form onSubmit={save} className="space-y-4">
              <fieldset disabled={busy} className="min-w-0 space-y-4">
                {!setupOnly ? <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
                  <input type="checkbox" className="size-4 accent-primary" checked={draft.enabled} disabled={!ready && !draft.enabled} onChange={event => edit('enabled', event.target.checked)} />
                  Enable website receptionist
                </label> : <p className="text-sm">Activation is an explicit choice in the final setup step. Saving here preserves the current enabled/off state.</p>}
                <label className="block space-y-1.5 text-sm font-medium"><span>Allowed website origins</span>
                  <textarea className={fieldClass} rows={3} maxLength={1600} value={draft.origins} onChange={event => edit('origins', event.target.value)} aria-describedby="website-origins-help" />
                </label>
                <p id="website-origins-help" className="text-xs text-muted-foreground">One exact HTTPS origin per line, up to five. Example: https://example.com. No paths, wildcards, or credentials. Origins and limits reduce abuse; they do not prove a visitor is human.</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block space-y-1.5 text-sm font-medium"><span>Daily message limit</span><Input className="min-h-11" type="number" required min={1} max={20} step={1} value={draft.dailyMessageLimit} onChange={event => edit('dailyMessageLimit', event.target.value)} /></label>
                  <label className="block space-y-1.5 text-sm font-medium"><span>Daily token allowance</span><Input className="min-h-11" type="number" required min={WEBSITE_REPLY_RESERVATION} max={200000} step={1} value={draft.dailyTokenLimit} onChange={event => edit('dailyTokenLimit', event.target.value)} /></label>
                  <label className="block space-y-1.5 text-sm font-medium"><span>Daily callback limit</span><Input className="min-h-11" type="number" required min={1} max={50} step={1} value={draft.dailyCallbackLimit} onChange={event => edit('dailyCallbackLimit', event.target.value)} /></label>
                </div>
                <p className="text-xs text-muted-foreground">Allowances reset daily in UTC. Each attempted reply reserves 9,656 tokens conservatively, including failures. The default 20,000 allowance permits at most two attempted replies per day. Your organization’s AI limits also apply. The callback form uses no AI.</p>
                <label className="flex min-h-11 items-start gap-3 py-2 text-sm"><input type="checkbox" className="mt-1 size-4 shrink-0 accent-primary" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />I understand that website replies use my organization’s AI provider and may incur charges within these limits.</label>
                <Button type="submit" className="min-h-11 whitespace-normal" disabled={busy || (draft.enabled && (!acknowledged || !ready))}>Save website receptionist settings</Button>
                {dirty && <p className="text-sm text-muted-foreground">Unsaved website settings</p>}
              </fieldset>
            </form>
            <p className="text-xs text-muted-foreground">Today (UTC): {data.usage.sessions} sessions, {data.usage.messages} attempted replies, {data.usage.reservedTokens.toLocaleString()} reserved tokens, {data.usage.callbacks} callback requests. Reload settings for current usage.</p>
            {snippet && <div className="space-y-2">
              <label className="block space-y-1.5 text-sm font-medium"><span>Website embed snippet</span><textarea className={`${fieldClass} break-all font-mono text-xs`} rows={4} value={snippet} readOnly onFocus={event => event.target.select()} /></label>
              <p className="text-xs text-muted-foreground">Select and copy this public snippet into your website. It contains only your public widget ID. The widget remains unavailable until enabled and saved for an allowed origin.</p>
            </div>}
          </>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {notice && <p role="status" className="text-sm">{notice}</p>}
        </CardContent>
      </Card>
      {!setupOnly && <Card>
        <CardHeader className="flex-col items-start gap-2"><CardTitle>Website callback requests</CardTitle><p className="text-sm text-muted-foreground">Requests confirmed by visitors for your team to review. Reviewing or dismissing does not call, message, create a lead, or schedule a task.</p></CardHeader>
        <CardContent className="min-w-0 space-y-4">
          <CallbackHandoffSource />
          <CallbackOutcomeQueue onClosed={() => { if (list) void loadCallbacks(loadedFilter, list.page).then(() => setCallbacksNotice('Callback closed and task completed.')) }} />
          <div className="flex flex-wrap items-end gap-3">
            <label className="block space-y-1.5 text-sm font-medium"><span>Callback status</span><select className={fieldClass} value={filter} disabled={callbacksBusy} onChange={event => setFilter(event.target.value as Filter)}><option value="pending">Pending</option><option value="reviewed">Reviewed</option><option value="dismissed">Dismissed</option><option value="all">All</option></select></label>
            <Button type="button" variant="outline" className="min-h-11 whitespace-normal" disabled={callbacksBusy} onClick={() => void loadCallbacks()}>{callbacksLoaded ? 'Reload callback requests' : 'Load callback requests'}</Button>
          </div>
          {callbacksBusy && <p className="text-sm text-muted-foreground">Working on callback requests…</p>}
          {callbacksNotice && <p role="status" className="text-sm">{callbacksNotice}</p>}
          {callbacksError && <p role="alert" className="text-sm text-destructive">{callbacksError}</p>}
          {list && <>
            <p className="text-xs text-muted-foreground">Showing {loadedFilter === 'all' ? 'all statuses' : loadedFilter} · Page {list.page} · Up to 20 requests per page</p>
            {!list.callbacks.length && <p className="text-sm text-muted-foreground">No callback requests in this view.</p>}
            <div className="space-y-4">{list.callbacks.map(record => <article key={record.id} aria-label={`Callback request from ${record.fullName}`} className="min-w-0 space-y-2 rounded-md border p-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2"><p className="break-words font-medium">{record.fullName}</p><p>{({ pending: 'Pending', reviewed: 'Reviewed', dismissed: 'Dismissed' })[record.status]}</p></div>
              <p className="break-all">{record.phone}</p>
              <p className="whitespace-pre-wrap break-words">{record.reason}</p>
              <p className="break-all text-xs text-muted-foreground">{record.siteOrigin}</p>
              <p className="text-xs text-muted-foreground">Consent confirmed: {new Date(record.consentedAt).toLocaleString()}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" className="min-h-11" disabled={callbacksBusy || record.status === 'reviewed'} onClick={() => void changeCallback(record, 'review')}>Mark reviewed</Button>
                <Button type="button" variant="outline" className="min-h-11" disabled={callbacksBusy || record.status === 'dismissed'} onClick={() => void changeCallback(record, 'dismiss')}>Dismiss callback</Button>
                <Button type="button" variant="outline" className="min-h-11" disabled={callbacksBusy} onClick={() => setDeleteId(record.id)}>Delete callback request</Button>
              </div>
              <CallbackHandoff callbackId={record.id} disabled={callbacksBusy} onCallbackClosed={() => { void loadCallbacks(loadedFilter, list.page).then(() => setCallbacksNotice('Callback closed and task completed.')) }} />
              {deleteId === record.id && <div className="space-y-2 rounded-md border p-3" role="alert"><p>Delete this callback request permanently? It will be removed from staff review.</p><div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" className="min-h-11" disabled={callbacksBusy} onClick={() => setDeleteId(null)}>Cancel deletion</Button>
                <Button type="button" variant="destructive" className="min-h-11" disabled={callbacksBusy} onClick={() => void changeCallback(record, 'delete')}>Confirm deletion</Button>
              </div></div>}
            </article>)}</div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="min-h-11" disabled={callbacksBusy || list.page <= 1} onClick={() => void loadCallbacks(loadedFilter, list.page - 1)}>Previous callback page</Button>
              <Button type="button" variant="outline" className="min-h-11" disabled={callbacksBusy || !list.hasMore} onClick={() => void loadCallbacks(loadedFilter, list.page + 1)}>Next callback page</Button>
            </div>
          </>}
        </CardContent>
      </Card>}
    </section>
  )
}
