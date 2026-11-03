'use client'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { callbackNotificationAck, callbackNotificationList, notificationHref, notificationTitle, type CallbackNotificationList } from '@/lib/callback-notifications'

export function NotificationInbox(): React.JSX.Element {
  const [data, setData] = useState<CallbackNotificationList | null>(null)
  const [filter, setFilter] = useState<'unread' | 'all'>('unread')
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const controller = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const active = (request: AbortController) => mounted.current && !request.signal.aborted && controller.current === request
  const query = useCallback(async (nextFilter: 'unread' | 'all', nextPage: number, request: AbortController) => {
    const response = await fetch(`/api/callback-notifications?filter=${nextFilter}&page=${nextPage}`, { headers: { 'X-Flowrish-Response-Targets': '1' }, cache: 'no-store', signal: request.signal })
    if (!response.ok) throw new Error('Unavailable')
    const next = callbackNotificationList.parse((await response.json()).data)
    if (next.page !== nextPage || new Set(next.rows.map(row => row.key)).size !== next.rows.length || nextFilter === 'unread' && next.rows.some(row => row.readAt !== null)) throw new Error('Unexpected response')
    if (mounted.current && !request.signal.aborted && controller.current === request) { setData(next); setFilter(nextFilter); setPage(nextPage) }
  }, [])
  const load = useCallback(async (nextFilter: 'unread' | 'all', nextPage: number) => {
    if (controller.current) return
    const request = new AbortController(); controller.current = request; setBusy(true); setError(''); setNotice(''); setData(null)
    try { await query(nextFilter, nextPage, request) }
    catch { if (mounted.current && !request.signal.aborted) setError('Unable to load notifications. Refresh to try again.') }
    finally { if (controller.current === request) controller.current = null; if (mounted.current && !request.signal.aborted) setBusy(false) }
  }, [query])
  useEffect(() => { mounted.current = true; void load('unread', 1); return () => { mounted.current = false; controller.current?.abort(); controller.current = null } }, [load])
  async function markRead(key: string) {
    if (controller.current) return
    const request = new AbortController(); controller.current = request; setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch(`/api/callback-notifications/${key}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ read: true }), signal: request.signal })
      if (!response.ok) {
        if ((response.status === 403 || response.status === 404) && active(request)) { setData(null); setError('This notification is no longer available. Refresh to see your current alerts.'); window.dispatchEvent(new Event('flowrish:callback-notifications-changed')); return }
        throw new Error('Unavailable')
      }
      const acknowledgement = callbackNotificationAck.parse((await response.json()).data)
      if (acknowledgement.key !== key) throw new Error('Unexpected response')
      if (!active(request)) return
      setNotice('Notification marked read.'); window.dispatchEvent(new Event('flowrish:callback-notifications-changed'))
      setData(null); await query(filter, 1, request)
    } catch { if (active(request)) setError('Unable to update notifications. Refresh or retry marking the same notification read.') }
    finally { if (controller.current === request) controller.current = null; if (mounted.current && !request.signal.aborted) setBusy(false) }
  }
  return <div className="mx-auto max-w-3xl space-y-5 pb-8">
    <header className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight">Notifications</h1><p className="max-w-2xl text-sm text-muted-foreground">Callback requests and work that currently needs your attention. Alerts are checked every five minutes; the bell refreshes while you use Flowrish.</p><Link href="/callbacks/response-targets" className="inline-flex min-h-11 items-center text-sm font-medium underline">View callback response targets</Link></header>
    <div className="flex flex-wrap items-end gap-3"><label className="grid gap-1.5 text-sm font-medium">Notification filter<select className="min-h-11 rounded-md border bg-background px-3 py-2" disabled={busy} value={filter} onChange={event => { void load(event.target.value as 'unread' | 'all', 1) }}><option value="unread">Unread</option><option value="all">All current alerts</option></select></label><Button variant="outline" disabled={busy} onClick={() => { void load(filter, page) }}>Refresh notifications</Button></div>
    {busy && <p role="status" className="text-sm text-muted-foreground">Loading notifications…</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {error && <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
    {data && <><p className="text-xs text-muted-foreground">Showing {filter} · Page {data.page}</p>{data.rows.length ? <div className="divide-y rounded-xl border bg-card">{data.rows.map(row => <article key={row.key} aria-label={notificationTitle(row.kind)} className="space-y-3 p-4 sm:p-5"><div className="flex flex-wrap items-center gap-x-3 gap-y-1"><h2 className="text-sm font-semibold">{notificationTitle(row.kind)}</h2><span className="text-xs text-muted-foreground">{row.readAt ? 'Read' : 'Unread'}</span></div><p className="text-xs text-muted-foreground"><time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString()}</time>{row.dueDate && <> · Due {new Date(row.dueDate).toLocaleString()}</>}</p><div className="flex flex-wrap items-center gap-3">{busy ? <span className="text-sm text-muted-foreground">{(row.kind === 'new_callback' || row.kind === 'handoff_escalation') ? 'Review callback requests' : 'Open callback task'}</span> : <Link href={notificationHref(row)} className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">{(row.kind === 'new_callback' || row.kind === 'handoff_escalation') ? 'Review callback requests' : 'Open callback task'}</Link>}{!row.readAt && <Button variant="outline" disabled={busy} onClick={() => { void markRead(row.key) }}>Mark read</Button>}</div></article>)}</div> : <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No notifications in this view.</p>}<div className="flex gap-2"><Button variant="outline" disabled={busy || page === 1} onClick={() => { void load(filter, page - 1) }}>Previous page</Button><Button variant="outline" disabled={busy || !data.hasMore} onClick={() => { void load(filter, page + 1) }}>Next page</Button></div></>}
    <p className="text-xs text-muted-foreground">Marking read changes only your notification. It does not review a callback, contact a visitor, complete a task, or record an outcome. Refreshing hides alerts whose work or access has changed.</p>
  </div>
}
