'use client'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { EMAIL_NOTIFICATION_EVENT, emailNotificationAck, emailNotificationHref, emailNotificationList, emailNotificationTitle, emailWaitingAge, type EmailNotificationContext } from '@/lib/email-notifications'
import { emailNotificationData, emailNotificationHeaders, EmailNotificationError } from '@/lib/email-notification-client'
import { WORKSPACE_EVENT } from '@/lib/workspace-context'
import type { z } from 'zod'
export function EmailNotificationInbox({ context }: { context: EmailNotificationContext }) { return <EmailAlerts key={`${context.organizationId}:${context.userId}`} context={context} /> }
function EmailAlerts({ context }: { context: EmailNotificationContext }) {
  const [data, setData] = useState<z.infer<typeof emailNotificationList> | null>(null), [filter, setFilter] = useState<'unread' | 'all'>('unread'), [page, setPage] = useState(1)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [revoked, setRevoked] = useState(false)
  const live = useRef(true), blocked = useRef(false), controller = useRef<AbortController | null>(null), lastAttempt = useRef(-Infinity)
  const active = (request: AbortController) => live.current && !request.signal.aborted && controller.current === request
  const failed = (cause: unknown) => {
    if (cause instanceof EmailNotificationError && ([401, 403].includes(cause.status) || /CONTEXT|WORKSPACE/.test(cause.code))) { blocked.current = true; setRevoked(true); setData(null); setError('Access changed. Reload to check the current account and business.'); return }
    if (cause instanceof EmailNotificationError && cause.status === 404) setData(null)
    setError(cause instanceof Error ? cause.message : 'Unable to update follow-up alerts. Retry the same acknowledgment.')
  }
  const query = useCallback(async (nextFilter: 'unread' | 'all', nextPage: number, request: AbortController) => {
    const response = await fetch(`/api/email-notifications?filter=${nextFilter}&page=${nextPage}`, { cache: 'no-store', headers: emailNotificationHeaders(context), signal: request.signal })
    const next = emailNotificationList.parse(await emailNotificationData(response, context))
    if (next.page !== nextPage || new Set(next.rows.map(row => row.key)).size !== next.rows.length || nextFilter === 'unread' && next.rows.some(row => row.readAt !== null)) throw new Error('Unexpected follow-up alert response. Refresh to try again.')
    if (live.current && !request.signal.aborted && controller.current === request) { setData(next); setFilter(nextFilter); setPage(nextPage) }
  }, [context])
  const load = useCallback(async (nextFilter: 'unread' | 'all', nextPage: number) => {
    if (controller.current || blocked.current || !live.current) return
    const request = new AbortController(); controller.current = request; lastAttempt.current = Date.now(); setBusy(true); setError(''); setNotice(''); setData(null)
    try { await query(nextFilter, nextPage, request) } catch (cause) { if (live.current && !request.signal.aborted) failed(cause) }
    finally { if (controller.current === request) controller.current = null; if (live.current && !request.signal.aborted) setBusy(false) }
  }, [query])
  useEffect(() => {
    live.current = true; void load('unread', 1)
    const changed = () => { blocked.current = true; controller.current?.abort(); setData(null); setRevoked(true); setBusy(false); setError('Access changed. Reload to check the current account and business.') }
    window.addEventListener(WORKSPACE_EVENT, changed)
    return () => { live.current = false; controller.current?.abort(); controller.current = null; window.removeEventListener(WORKSPACE_EVENT, changed) }
  }, [load])
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible' && Date.now() - lastAttempt.current >= 60000) void load(filter, page) }
    const timer = window.setInterval(refresh, 60000); window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [load, filter, page])
  async function markRead(key: string) {
    if (controller.current || blocked.current) return
    const request = new AbortController(); controller.current = request; setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch(`/api/email-notifications/${key}`, { method: 'PATCH', headers: { ...emailNotificationHeaders(context), 'Content-Type': 'application/json' }, body: JSON.stringify({ read: true }), signal: request.signal })
      const acknowledgment = emailNotificationAck.parse(await emailNotificationData(response, context))
      if (acknowledgment.key !== key) throw new Error('Unexpected acknowledgment. Retry marking the same follow-up alert read.')
      if (!active(request)) return
      setNotice('Follow-up alert marked read.'); window.dispatchEvent(new Event(EMAIL_NOTIFICATION_EVENT)); setData(null); await query(filter, 1, request)
    } catch (cause) { if (active(request)) failed(cause) }
    finally { if (controller.current === request) controller.current = null; if (live.current && !request.signal.aborted) setBusy(false) }
  }
  return <section aria-label="Follow-up alerts" className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
    <h2 className="font-semibold">Follow-up alerts</h2><p className="text-sm text-muted-foreground">Reminders, replies and address matches waiting for your review. Resolved work disappears on refresh; visible alerts refresh every minute.</p>
    <div className="flex flex-wrap items-end gap-3"><label className="grid gap-1.5 text-sm font-medium">Follow-up notification filter<select className="min-h-11 rounded-md border bg-background px-3 py-2" value={filter} disabled={busy || revoked} onChange={event => void load(event.target.value as 'unread' | 'all', 1)}><option value="unread">Unread</option><option value="all">All current alerts</option></select></label><Button variant="outline" disabled={busy || revoked} onClick={() => void load(filter, page)}>Refresh follow-up alerts</Button></div>
    {busy && <p role="status" className="text-sm text-muted-foreground">Loading follow-up alerts…</p>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}{notice && <p role="status" className="text-sm">{notice}</p>}
    {data && <><p className="text-xs text-muted-foreground">Follow-up alerts · {filter} · Page {data.page}</p>{data.rows.length ? <div className="divide-y rounded-lg border">{data.rows.map(row => <article key={row.key} aria-label={emailNotificationTitle(row.kind)} className="space-y-2 p-4"><div className="flex flex-wrap items-center gap-3"><h3 className="text-sm font-semibold">{emailNotificationTitle(row.kind)}</h3><span className="text-xs text-muted-foreground">{row.readAt ? 'Read' : 'Unread'}</span></div><p className="text-sm">{emailWaitingAge(row.createdAt)}</p><time className="block text-xs text-muted-foreground" dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString()}</time><div className="flex flex-wrap items-center gap-3">{busy ? <span className="text-sm text-muted-foreground">{row.kind === 'email_match' ? 'Review email match' : row.kind === 'follow_up_reminder' ? 'Review follow-up' : 'Review email reply'}</span> : <Link className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4" href={emailNotificationHref(row)}>{row.kind === 'email_match' ? 'Review email match' : row.kind === 'follow_up_reminder' ? 'Review follow-up' : 'Review email reply'}</Link>}{!row.readAt && <Button variant="outline" disabled={busy} onClick={() => void markRead(row.key)}>Mark follow-up alert read</Button>}</div></article>)}</div> : <p className="py-6 text-sm text-muted-foreground">No follow-up alerts in this view.</p>}<div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || page === 1} onClick={() => void load(filter, page - 1)}>Previous follow-up page</Button><Button variant="outline" disabled={busy || !data.hasMore} onClick={() => void load(filter, page + 1)}>Next follow-up page</Button></div></>}
    <p className="text-xs text-muted-foreground">Marking read acknowledges only your alert. It does not resolve a match, approve a task, generate a draft, or send email.</p>
  </section>
}
