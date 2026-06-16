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
  /** Optional extra class for the root element. */
  className?: string
}

interface ConnectionState {
  status: 'loading' | 'connected' | 'disconnected'
  email: string | null
}

/**
 * Gmail OAuth connection flow component.
 *
 * On mount, queries `/api/email/account` to see whether the user has
 * already connected a Gmail account. The result drives whether the
 * "Connect Gmail" button or the connected-state card renders.
 *
 * When the user clicks Connect, a popup opens to Google's consent
 * screen. The callback page (`/api/email/callback`) handles the code
 * exchange server-side (which lets us pass the exact request origin as
 * `redirect_uri` and avoids fragile env-derived URIs), then posts a
 * `gmail-oauth-success` message back to this window.
 *
 * Validates: Requirements 7.1
 */
export function GmailConnect({
  googleClientId,
  redirectUri,
  onConnected,
  className,
}: GmailConnectProps): React.JSX.Element {
  const [state, setState] = useState<ConnectionState>({
    status: 'loading',
    email: null,
  })
  const [error, setError] = useState<string | null>(null)
  const [popupOpen, setPopupOpen] = useState(false)
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
          data: { id: string; email: string } | null
        }
        if (cancelled) return
        if (body.data) {
          setState({ status: 'connected', email: body.data.email })
        } else {
          setState({ status: 'disconnected', email: null })
        }
      } catch (err) {
        if (cancelled) return
        // Treat fetch failure as "not connected" so the user can still
        // see and click the connect button.
        setState({ status: 'disconnected', email: null })
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
        setState({ status: 'connected', email: data.data.email })
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
    if (
      !confirm(
        'Disconnect Gmail? You\u2019ll need to reconnect before sending or syncing email again.',
      )
    ) {
      return
    }
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
      setState({ status: 'disconnected', email: null })
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
        <div className="flex items-center gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          <CheckCircle2
            className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-hidden="true"
          />
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">Gmail connected</p>
            {state.email ? (
              <p className="text-xs text-muted-foreground">{state.email}</p>
            ) : null}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={disconnect}
            disabled={disconnecting}
          >
            {disconnecting ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                <span>Disconnecting…</span>
              </>
            ) : (
              <>
                <Unplug className="size-3.5" aria-hidden="true" />
                <span>Disconnect</span>
              </>
            )}
          </Button>
        </div>
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
