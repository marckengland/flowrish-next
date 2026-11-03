'use client'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { responseTargetListSchema, type ResponseTargetList } from '@/lib/callback-response'
export function ResponseTargetQueue(): React.JSX.Element {
  const [data, setData] = useState<ResponseTargetList | null>(null), [filter, setFilter] = useState<'missed' | 'all'>('missed'), [page, setPage] = useState(1), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const mounted = useRef(true), pending = useRef<AbortController | null>(null), currentFilter = useRef<'missed' | 'all'>('missed')
  const load = useCallback(async (nextFilter: 'missed' | 'all', nextPage: number, force = false) => {
    if (pending.current && !force) return
    pending.current?.abort(); const request = new AbortController(); pending.current = request; setBusy(true); setData(null); setError('')
    try {
      const response = await fetch(`/api/callback-response-targets?filter=${nextFilter}&page=${nextPage}`, { cache: 'no-store', signal: request.signal })
      if (!response.ok) throw new Error('Unavailable')
      const next = responseTargetListSchema.parse((await response.json()).data)
      if (next.page !== nextPage || new Set(next.rows.map(row => `${row.callbackId}:${row.phase}`)).size !== next.rows.length || nextFilter === 'missed' && next.rows.some(row => !row.missed)) throw new Error('Unexpected queue')
      if (mounted.current && !request.signal.aborted && pending.current === request) { setData(next); setFilter(nextFilter); currentFilter.current = nextFilter; setPage(nextPage) }
    } catch { if (mounted.current && !request.signal.aborted && pending.current === request) setError('Unable to load response targets. Refresh to try again.') }
    finally { if (pending.current === request) pending.current = null; if (mounted.current && !request.signal.aborted) setBusy(false) }
  }, [])
  useEffect(() => { mounted.current = true; void load('missed', 1); const changed = () => { void load(currentFilter.current, 1, true) }; window.addEventListener('flowrish:callback-response-policy-changed', changed); return () => { mounted.current = false; pending.current?.abort(); pending.current = null; window.removeEventListener('flowrish:callback-response-policy-changed', changed) } }, [load])
  return <section aria-label="Callback response targets" className="min-w-0 space-y-4"><h2 className="text-lg font-semibold">Waiting callbacks</h2><p className="text-sm text-muted-foreground">Administrators see eligible handoff work; CRM staff see their own contact targets. Managers with CRM access can review all current targets. Checks run every five minutes; refresh to see the latest state.</p>
    <div className="flex flex-wrap items-end gap-3"><label className="grid gap-1 text-sm font-medium">Response target filter<select className="min-h-11 rounded-md border bg-background px-3 py-2" value={filter} disabled={busy} onChange={event => { void load(event.target.value as 'missed' | 'all', 1) }}><option value="missed">Missed targets</option><option value="all">All waiting targets</option></select></label><Button className="min-h-11" variant="outline" disabled={busy} onClick={() => { void load(filter, page) }}>Refresh response targets</Button></div>
    {busy && <p role="status" className="text-sm">Loading response targets…</p>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {data && <>{!data.policyEnabled && <p className="text-sm">Response targets are paused. An administrator can enable a policy above.</p>}<p className="text-xs text-muted-foreground">Showing {filter} · Page {data.page}</p>{data.rows.length ? <div className="divide-y rounded-xl border bg-card">{data.rows.map(row => <article key={`${row.callbackId}:${row.phase}`} className="space-y-3 p-4"><h3 className="text-sm font-semibold">{row.phase === 'handoff' ? row.missed ? 'CRM handoff target missed' : 'Waiting for CRM handoff' : row.missed ? 'First contact target missed' : 'Waiting for recorded contact'}</h3><p className="text-xs text-muted-foreground">Due <time dateTime={row.dueAt}>{new Date(row.dueAt).toLocaleString()}</time> · Waiting since {new Date(row.startedAt).toLocaleString()}</p>{row.assigneeName && <p className="break-words text-sm">{row.assigneeName}</p>}<Link className="inline-flex min-h-11 items-center text-sm font-medium underline" href={row.phase === 'handoff' ? '/settings?section=receptionist' : `/tasks/${row.taskId}`}>{row.phase === 'handoff' ? 'Review callback requests' : 'Open callback task'}</Link></article>)}</div> : <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">No response targets in this view.</p>}<div className="flex gap-2"><Button className="min-h-11" variant="outline" disabled={busy || page === 1} onClick={() => { void load(filter, page - 1) }}>Previous page</Button><Button className="min-h-11" variant="outline" disabled={busy || !data.hasMore} onClick={() => { void load(filter, page + 1) }}>Next page</Button></div></>}
  </section>
}
