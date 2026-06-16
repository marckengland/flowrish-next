'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Loader2, Mail, Unplug } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Gmail OAuth scopes required for sending and reading emails.
 */
const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
].join(' ')

export interface GmailConnectProps {
  /** Google OAuth Client ID (public, safe to expose to client). */
  googleClientId: string
  /** The redirect URI for the OAuth callback. */
  redirectUri: string
  /** Called after a successful connection. */
  onConnected?: (result: { email: string; accountId: string }) => void
  /** Called after a successful disconnection. */
  onDisconnected?: () => void
  /** Optional extra class for the root element. */
  className?: string
}

interface ConnectionState {
  status: 'loading' | 'connected' | 'disconnected'
  email: string | null
  lastSyncAt: string | null
}

/**
 * Gmail OAuth connection flow component.
 *
 * On mount, queries `/api/email/account` to see whether the user has
 * already connected a Gmail account. The result drives whether the
 * "Connect Gmail" button or the connected-state card renders.
 *
 * Disconnect surfaces a panel that spells out exactly what happens
 * (revokes Google's refresh token, deletes the local account, leaves
 * sent message history alone) before deleting anything.
 *
 * Validates: Requirements 7.1
 */
export function GmailConnect({
  googleClientId,
  redirectUri,
  onConnected,
  onDisconnected,
  className,
}: GmailConnectProps): React.JSX.Element {
  const [state, setState] = useState<ConnectionState>({
    status: 'loading',
    email: null,
    lastSyncAt: null,
  })
  const [error, setError] = useState<string | null>(null)
  const [popupOpen, setPopupOpen] = useState(false)
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  // Fetch the current connection state on mount so the UI reflects
  // what's actually stored on the server (so a page reload after a
  // previous connect still shows "connected").
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/email/account', {
          credentials: 'same-origin',
          cache: 'no-store',
        })
        if (!res.ok) throw new Error(`Failed (${res.status})`)
        const body = (await res.json()) as {
          data: {
            id: string
            email: string
            lastSyncAt: string | null
          } | null
        }
        if (cancelled) return
        if (body.data) {
          setState({
            status: 'connected',
            email: body.data.email,
            lastSyncAt: body.data.lastSyncAt,
          })
        } else {
          setState({ status: 'disconnected', email: null, lastSyncAt: null })
        }
      } catch (err) {
        if (cancelled) return
        // Treat fetch failure as "not connected" so the user can still
        // see and click the connect button.
        setState({ status: 'disconnected', email: null, lastSyncAt: null })
        setError(
          err instanceof Error ? err.message : 'Failed to load Gmail status.',
        )
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * Receives the popup callback. The server-rendered close-page in
   * /api/email/callback already exchanges the authorization code for
   * tokens, so the message we get here either reports success (with the
   * connected email) or an error string we should surface.
   */
  const handleOAuthMessage = useCallback(
    (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const data = event.data as {
        type?: string
        data?: { email: string; accountId: string }
        error?: string
      }
      if (data.type === 'gmail-oauth-success' && data.data) {
        setState({
          status: 'connected',
          email: data.data.email,
          lastSyncAt: null,
        })
        setError(null)
        setPopupOpen(false)
        onConnected?.(data.data)
      } else if (data.type === 'gmail-oauth-error') {
        setError(data.error ?? 'Failed to connect Gmail.')
        setPopupOpen(false)
      }
    },
    [onConnected],
  )

  useEffect(() => {
    window.addEventListener('message', handleOAuthMessage)
    return () => window.removeEventListener('message', handleOAuthMessage)
  }, [handleOAuthMessage])

  async function disconnect(): Promise<void> {
    setError(null)
    setDisconnecting(true)
    try {
      const res = await fetch('/api/email/account', {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        throw new Error(
          body.error?.message ?? `Failed to disconnect (${res.status})`,
        )
      }
      setState({ status: 'disconnected', email: null, lastSyncAt: null })
      setConfirmingDisconnect(false)
      onDisconnected?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect.')
    } finally {
      setDisconnecting(false)
    }
  }

  function startOAuthFlow(): void {
    setError(null)

    if (!googleClientId) {
      setError(
        'Gmail integration is not configured. Set NEXT_PUBLIC_GOOGLE_CLIENT_ID and redeploy.',
      )
      return
    }

    const params = new URLSearchParams({
      client_id: googleClientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GMAIL_SCOPES,
      access_type: 'offline',
      prompt: 'consent',
    })

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`

    const width = 500
    const height = 600
    const left = window.screenX + (window.outerWidth - width) / 2
    const top = window.screenY + (window.outerHeight - height) / 2

    setPopupOpen(true)
    const popup = window.open(
      authUrl,
      'gmail-oauth',
      `width=${width},height=${height},left=${left},top=${top},popup=yes`,
    )

    if (!popup) {
      setPopupOpen(false)
      setError(
        'Popup blocked. Please allow popups for this site and try again.',
      )
    }
  }

  if (state.status === 'loading') {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-md border bg-card px-4 py-3 text-sm text-muted-foreground',
          className,
        )}
        role="status"
        aria-live="polite"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        <span>Checking Gmail connection…</span>
      </div>
    )
  }

  if (state.status === 'connected') {
    return (
      <div className={cn('flex flex-col gap-2', className)}>
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          <CheckCircle2
            className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">Gmail connected</p>
            {state.email ? (
              <p className="truncate text-xs text-muted-foreground">
                {state.email}
              </p>
            ) : null}
            {state.lastSyncAt ? (
              <p className="text-[11px] text-muted-foreground">
                Last sync: {formatRelative(state.lastSyncAt)}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setConfirmingDisconnect((v) => !v)}
            disabled={disconnecting}
          >
            <Unplug className="size-3.5" aria-hidden="true" />
            <span>Disconnect</span>
          </Button>
        </div>

        {confirmingDisconnect ? (
          <div className="flex flex-col gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4">
            <div>
              <h4 className="text-sm font-semibold text-foreground">
                Disconnect Gmail?
              </h4>
              <p className="mt-1 text-xs text-muted-foreground">
                Here&apos;s exactly what happens when you click Disconnect:
              </p>
            </div>
            <ul className="space-y-1.5 text-xs text-foreground">
              <li className="flex gap-2">
                <span aria-hidden className="text-destructive">✕</span>
                <span>
                  Your refresh token is revoked at Google so it can&apos;t be
                  used again, even if a copy leaked.
                </span>
              </li>
              <li className="flex gap-2">
                <span aria-hidden className="text-destructive">✕</span>
                <span>
                  Your encrypted tokens and the EmailAccount record are
                  deleted from this app.
                </span>
              </li>
              <li className="flex gap-2">
                <span aria-hidden className="text-destructive">✕</span>
                <span>
                  Outbound email, Send-test-email, and inbox sync stop
                  working from your account until you reconnect.
                </span>
              </li>
              <li className="flex gap-2">
                <span aria-hidden className="text-destructive">✕</span>
                <span>
                  Cadence steps that were going to send from your Gmail
                  will fail their next attempt.
                </span>
              </li>
              <li className="flex gap-2">
                <span aria-hidden className="text-emerald-600 dark:text-emerald-400">
                  ✓
                </span>
                <span>
                  Past email activity in lead timelines is preserved
                  (history isn&apos;t a credential).
                </span>
              </li>
              <li className="flex gap-2">
                <span aria-hidden className="text-emerald-600 dark:text-emerald-400">
                  ✓
                </span>
                <span>
                  Other teammates&apos; Gmail connections are unaffected
                  &mdash; each person manages their own.
                </span>
              </li>
              <li className="flex gap-2">
                <span aria-hidden className="text-emerald-600 dark:text-emerald-400">
                  ✓
                </span>
                <span>
                  You can reconnect any time from this same screen.
                </span>
              </li>
            </ul>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setConfirmingDisconnect(false)}
                disabled={disconnecting}
              >
                Keep connected
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={disconnect}
                disabled={disconnecting}
              >
                {disconnecting ? (
                  <>
                    <Loader2
                      className="size-3.5 animate-spin"
                      aria-hidden="true"
                    />
                    <span>Disconnecting…</span>
                  </>
                ) : (
                  <>
                    <Unplug className="size-3.5" aria-hidden="true" />
                    <span>Yes, disconnect</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-col gap-2 rounded-md border border-dashed bg-card px-4 py-5">
        <div className="flex items-center gap-2">
          <Unplug className="size-5 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">
            Connect your Gmail account
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          Connect Gmail to send and track emails directly from the CRM.
          Your OAuth tokens are encrypted at rest.
        </p>
        <div className="mt-2">
          <Button
            type="button"
            size="sm"
            onClick={startOAuthFlow}
            disabled={popupOpen}
          >
            {popupOpen ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                <span>Waiting for Google…</span>
              </>
            ) : (
              <>
                <Mail className="size-3.5" aria-hidden="true" />
                <span>Connect Gmail</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Formats an ISO timestamp as a relative time string (e.g. "2 hours
 * ago"). Falls back to a locale-formatted date for older timestamps.
 */
function formatRelative(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const diffMs = Date.now() - date.getTime()
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diffMs < minute) return 'just now'
  if (diffMs < hour) return `${Math.floor(diffMs / minute)} min ago`
  if (diffMs < day) return `${Math.floor(diffMs / hour)} hr ago`
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)} day(s) ago`
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}
