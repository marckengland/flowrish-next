'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useFollowUpCounts } from '@/components/follow-ups/use-follow-up-counts'
import { FOLLOW_UP_ACCESS_EVENT, type FollowUpContext } from '@/lib/follow-up-access'
import { WORKSPACE_EVENT } from '@/lib/workspace-context'

const filters = { search: '', source: 'ALL' as const, dueOnly: false, needsChecking: true }
const tabs = [
  ['PENDING', 'Pending'], ['APPROVED', 'Approved'],
  ['DISMISSED', 'Dismissed'], ['SNOOZED', 'Snoozed'],
] as const
const href = (status: string) => `/follow-ups?needsChecking=1&status=${status}`
type Props = { context: FollowUpContext; canWrite: boolean }

export function NeedsCheckingSummary({ context, canWrite }: Props) {
  return canWrite ? <Summary key={`${context.organizationId}:${context.userId}`} context={context} /> : null
}

function Summary({ context }: Pick<Props, 'context'>) {
  const [connection, setConnection] = useState({ ready: false, offline: false, paused: false })
  const [revoked, setRevoked] = useState(false)
  const [stale, setStale] = useState(false)
  const loseAccess = useCallback(() => setRevoked(true), [])
  const counts = useFollowUpCounts({ context, filters, enabled: connection.ready && !connection.offline && !connection.paused && !revoked, revision: 0, onAccessLost: loseAccess })

  useEffect(() => {
    setConnection({ ready: true, offline: !navigator.onLine, paused: !navigator.onLine })
    const offline = () => setConnection({ ready: true, offline: true, paused: true })
    const online = () => setConnection({ ready: true, offline: false, paused: true })
    const markStale = () => setStale(true)
    const visible = () => { if (document.visibilityState === 'visible') markStale() }
    window.addEventListener('offline', offline)
    window.addEventListener('online', online)
    window.addEventListener('focus', markStale)
    document.addEventListener('visibilitychange', visible)
    window.addEventListener(WORKSPACE_EVENT, loseAccess)
    window.addEventListener(FOLLOW_UP_ACCESS_EVENT, loseAccess)
    return () => {
      window.removeEventListener('offline', offline)
      window.removeEventListener('online', online)
      window.removeEventListener('focus', markStale)
      document.removeEventListener('visibilitychange', visible)
      window.removeEventListener(WORKSPACE_EVENT, loseAccess)
      window.removeEventListener(FOLLOW_UP_ACCESS_EVENT, loseAccess)
    }
  }, [loseAccess])

  useEffect(() => {
    if (!counts.data) return
    setStale(false)
    const timer = window.setTimeout(() => setStale(true), 60_000)
    return () => window.clearTimeout(timer)
  }, [counts.data])

  const verified = !revoked && !connection.offline && !connection.paused && !stale && counts.status === 'ready' ? counts.data : undefined
  const total = verified ? Object.values(verified.counts).reduce((sum, count) => sum + count, 0) : undefined
  const message = revoked ? 'Access changed. Reload the dashboard before continuing.'
    : connection.offline ? 'Offline. Refresh the summary when connected.'
      : connection.paused ? 'Connection changed. Refresh the summary to continue.'
        : counts.status === 'error' ? 'Summary unavailable. Refresh to try again.'
          : stale ? 'Summary needs refreshing.'
            : total === undefined ? 'Checking summary…'
              : total === 0 ? 'No email sends need checking.'
                : total === 1 ? '1 email send needs checking' : `${total} email sends need checking`

  function refresh() {
    if (revoked || !navigator.onLine) return
    setStale(false)
    setConnection({ ready: true, offline: false, paused: false })
    counts.refresh()
  }

  return <section aria-label="Needs checking summary" className="min-w-0 space-y-3 rounded-xl border bg-card p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Needs checking</h2>
        <p role={counts.status === 'error' && !revoked ? 'alert' : 'status'} className="text-sm">{message}</p>
      </div>
      <Button type="button" variant="outline" size="sm" disabled={revoked || !connection.ready || connection.offline || counts.status === 'loading'} onClick={refresh}>Refresh summary</Button>
    </div>
    {verified && <nav aria-label="Needs checking inbox tabs" className="flex flex-wrap gap-4">
      {total === 0 ? <Link href={href('PENDING')} prefetch={false} className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">Open Needs checking</Link>
        : tabs.filter(([tab]) => verified.counts[tab] > 0).map(([tab, label]) => <Link key={tab} href={href(tab)} prefetch={false} className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">{label} ({verified.counts[tab]})</Link>)}
    </nav>}
    {!revoked && counts.data && <p className="text-xs text-muted-foreground">Last checked: <time dateTime={counts.data.checkedAt}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(counts.data.checkedAt))}</time></p>}
    <p className="text-xs text-muted-foreground">Saved send results across inbox tabs. Status checks never resend email.</p>
  </section>
}
