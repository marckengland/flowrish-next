'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
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
  /** Whether the user already has a connected Gmail account. */
  isConnected: boolean
  /** The connected email address (if already connected). */
  connectedEmail?: string | null
  /** Google OAuth Client ID (public, safe to expose to client). */
  googleClientId: string
  /** The redirect URI for the OAuth callback. */
  redirectUri: string
  /** Called after a successful connection. */
  onConnected?: (result: { email: string; accountId: string }) => void
  /** Optional extra class for the root element. */
  className?: string
}

/**
 * Gmail OAuth connection flow component.
 *
 * When not connected, shows a "Connect Gmail" button that opens the
 * Google OAuth consent screen. After the user grants access, the OAuth
 * callback redirects back with an authorization code which is exchanged
 * for tokens via `POST /api/email/connect`.
 *
 * When already connected, shows the connected email address with a
 * success indicator.
 *
 * Validates: Requirements 7.1
 */
export function GmailConnect({
  isConnected: initialConnected,
  connectedEmail: initialEmail,
  googleClientId,
  redirectUri,
  onConnected,
  className,
}: GmailConnectProps): React.JSX.Element {
  const [isConnected, setIsConnected] = useState(initialConnected)
  const [connectedEmail, setConnectedEmail] = useState(initialEmail ?? null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  /**
   * Listen for the OAuth callback message from the popup window.
   * The callback page posts the authorization code back to this window.
   */
  const handleOAuthMessage = useCallback(
    (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const data = event.data as { type?: string; code?: string; error?: string }
      if (data.type !== 'gmail-oauth-callback') return

      if (data.error) {
        setError(data.error)
        return
      }

      if (data.code) {
        exchangeCode(data.code)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  useEffect(() => {
    window.addEventListener('message', handleOAuthMessage)
    return () => window.removeEventListener('message', handleOAuthMessage)
  }, [handleOAuthMessage])

  function exchangeCode(code: string): void {
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch('/api/email/connect', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          credentials: 'same-origin',
          body: JSON.stringify({ code }),
        })

        if (!res.ok) {
          let message = `Failed to connect Gmail (${res.status})`
          try {
            const body = (await res.json()) as { error?: { message?: string } }
            if (body.error?.message) message = body.error.message
          } catch {
            // ignore parse failure
          }
          setError(message)
          return
        }

        const body = (await res.json()) as {
          data: { email: string; accountId: string }
        }
        setIsConnected(true)
        setConnectedEmail(body.data.email)
        onConnected?.(body.data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to connect Gmail.')
      }
    })
  }

  function startOAuthFlow(): void {
    setError(null)

    const params = new URLSearchParams({
      client_id: googleClientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GMAIL_SCOPES,
      access_type: 'offline',
      prompt: 'consent',
    })

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`

    // Open in a popup so the user doesn't lose their current page context
    const width = 500
    const height = 600
    const left = window.screenX + (window.outerWidth - width) / 2
    const top = window.screenY + (window.outerHeight - height) / 2

    window.open(
      authUrl,
      'gmail-oauth',
      `width=${width},height=${height},left=${left},top=${top},popup=yes`,
    )
  }

  if (isConnected) {
    return (
      <div
        className={cn(
          'flex items-center gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3',
          className,
        )}
      >
        <CheckCircle2
          className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400"
          aria-hidden="true"
        />
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">Gmail connected</p>
          {connectedEmail ? (
            <p className="text-xs text-muted-foreground">{connectedEmail}</p>
          ) : null}
        </div>
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
            disabled={isPending}
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                <span>Connecting…</span>
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
