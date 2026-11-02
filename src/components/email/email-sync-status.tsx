'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface MailboxSyncHealth {
  id: string
  provider: string
  email: string
  lastSyncAt: string | null
  lastAttemptAt: string | null
  requestedAt: string | null
  status: 'idle' | 'queued' | 'running' | 'healthy' | 'failed'
  error: string | null
  automatic: boolean
}

export interface EmailSyncStatusProps {
  className?: string
  canWrite?: boolean
}

const labels: Record<MailboxSyncHealth['status'], string> = {
  idle: 'Not synced yet', queued: 'Queued', running: 'Syncing…', healthy: 'Up to date', failed: 'Sync needs attention',
}

/** Polls persisted health only; actual mailbox reads run in durable background jobs. */
export function EmailSyncStatus({ className, canWrite = true }: EmailSyncStatusProps): React.JSX.Element {
  const [accounts, setAccounts] = useState<MailboxSyncHealth[]>([])
  const [serverCanWrite, setServerCanWrite] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [pendingId, setPendingId] = useState<string | null>(null)
  const mounted = useRef(false)
  const fetching = useRef(false)

  const load = useCallback(async (): Promise<void> => {
    if (fetching.current) return
    fetching.current = true
    if (mounted.current) setRefreshing(true)
    try {
      const response = await fetch('/api/email/sync', { credentials: 'same-origin' })
      if (!response.ok) throw new Error('Unable to load mailbox sync status.')
      const body = await response.json() as { data: MailboxSyncHealth[]; capabilities?: { canWrite?: boolean } }
      if (!Array.isArray(body.data)) throw new Error('Unable to load mailbox sync status.')
      if (mounted.current) {
        setAccounts(body.data)
        setServerCanWrite(body.capabilities?.canWrite === true)
        setError(null)
      }
    } catch {
      if (mounted.current) setError('Unable to load mailbox sync status. Refresh to try again.')
    } finally {
      fetching.current = false
      if (mounted.current) { setLoading(false); setRefreshing(false) }
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    if (document.visibilityState === 'visible') void load()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, 30_000)
    const visible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', visible)
    return () => { mounted.current = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [load])

  async function syncNow(account: MailboxSyncHealth): Promise<void> {
    if (pendingId || !canWrite || !serverCanWrite) return
    setPendingId(account.id)
    setNotice('')
    setError(null)
    try {
      const response = await fetch('/api/email/sync', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: account.provider }) })
      const body = await response.json() as { data?: { status?: string }; error?: { message?: string } }
      if (!response.ok) throw new Error(body.error?.message || 'Unable to queue sync. Try again.')
      if (mounted.current) {
        const status = body.data?.status === 'running' ? 'running' : 'queued'
        setAccounts((rows) => rows.map((row) => row.id === account.id ? { ...row, status, error: null } : row))
        setNotice(status === 'running' ? 'Sync is already running.' : 'Sync queued. Status updates automatically.')
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Unable to queue sync. Try again.')
    } finally {
      if (mounted.current) setPendingId(null)
    }
  }

  return (
    <section aria-label="Mailbox sync" className={className}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-sm font-semibold">Mailbox sync</h2><p className="mt-1 text-xs text-muted-foreground">Reply detection runs when a mailbox sync completes.</p></div>
        <Button type="button" size="sm" variant="outline" disabled={refreshing} onClick={() => void load()} aria-label="Refresh sync status"><RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh status</Button>
      </div>
      {loading ? <p className="mt-3 text-xs text-muted-foreground">Loading sync status…</p> : accounts.length === 0 && !error ? <p className="mt-3 text-sm text-muted-foreground">Connect Gmail or Microsoft 365 in Settings to monitor incoming replies.</p> : null}
      {error && <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p>}
      {notice && <p role="status" className="mt-3 text-xs text-muted-foreground">{notice}</p>}
      <div className="mt-3 grid min-w-0 gap-3">
        {accounts.map((account) => {
          const provider = account.provider === 'microsoft' ? 'Microsoft 365' : 'Gmail'
          const active = account.status === 'queued' || account.status === 'running'
          return <div key={account.id} className="min-w-0 rounded-lg border bg-background p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0"><p className="break-all text-sm font-medium">{account.email}</p><p className="mt-0.5 text-xs text-muted-foreground">{provider}</p></div>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">{active ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : account.status === 'healthy' ? <CheckCircle className="size-3.5 text-brand" aria-hidden="true" /> : null}{labels[account.status]}</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{account.lastSyncAt ? <>Last successful sync: <time dateTime={account.lastSyncAt}>{new Date(account.lastSyncAt).toLocaleString()}</time></> : 'No successful sync yet.'}</p>
            <p className="mt-1 text-xs text-muted-foreground">{account.automatic ? 'Automatic checks every five minutes. Status refreshes while this page is visible.' : 'Automatic checks are unavailable. Ask an administrator to configure background sync.'}</p>
            {account.status === 'failed' && <p role="alert" className="mt-2 flex items-start gap-1.5 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{account.error || 'Mailbox sync failed. Try syncing again or reconnect this mailbox in Settings.'}</p>}
            {canWrite && serverCanWrite && <Button type="button" size="sm" variant="outline" className="mt-3" disabled={pendingId !== null || active} aria-label={`Sync ${provider} now`} onClick={() => void syncNow(account)}>{pendingId === account.id ? 'Queuing…' : 'Sync now'}</Button>}
          </div>
        })}
      </div>
    </section>
  )
}
