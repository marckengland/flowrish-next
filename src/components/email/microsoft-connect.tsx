'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Mail, Unplug } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { MicrosoftSetupCard } from '@/components/email/microsoft-setup-card'

/** Delegated Graph scopes requested in the browser authorize step. */
const MS_SCOPES = [
  'offline_access',
  'openid',
  'profile',
  'User.Read',
  'Mail.Read',
  'Mail.Send',
].join(' ')

export interface MicrosoftConnectProps {
  /** Public Azure app (client) ID. When empty, setup instructions render instead. */
  clientId: string
  redirectUri: string
  className?: string
}

interface ConnectionState {
  status: 'loading' | 'connected' | 'disconnected'
  email: string | null
  lastSyncAt: string | null
}

/**
 * Outlook / Microsoft 365 connector. Mirrors the Gmail connector's popup
 * OAuth flow, scoped to `provider=microsoft`. When the deployment hasn't
 * registered an Azure app yet (`clientId` empty), it renders the setup
 * instructions card instead of a dead connect button.
 */
export function MicrosoftConnect({
  clientId,
  redirectUri,
  className,
}: MicrosoftConnectProps): React.JSX.Element {
  const [state, setState] = useState<ConnectionState>({
    status: 'loading',
    email: null,
    lastSyncAt: null,
  })
  const [error, setError] = useState<string | null>(null)
  const [popupOpen, setPopupOpen] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  const configured = Boolean(clientId)

  useEffect(() => {
    if (!configured) {
      setState({ status: 'disconnected', email: null, lastSyncAt: null })
      return
    }
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/email/account?provider=microsoft', {
          credentials: 'same-origin',
          cache: 'no-store',
        })
        if (!res.ok) throw new Error(`Failed (${res.status})`)
        const body = (await res.json()) as {
          data: { id: string; email: string; lastSyncAt: string | null } | null
        }
        if (cancelled) return
        setState(
          body.data
            ? { status: 'connected', email: body.data.email, lastSyncAt: body.data.lastSyncAt }
            : { status: 'disconnected', email: null, lastSyncAt: null },
        )
      } catch {
        if (!cancelled) setState({ status: 'disconnected', email: null, lastSyncAt: null })
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [configured])

  const handleMessage = useCallback((event: MessageEvent) => {
    if (event.origin !== window.location.origin) return
    const data = event.data as {
      type?: string
      data?: { email: string; accountId: string }
      error?: string
    }
    if (data.type === 'microsoft-oauth-success' && data.data) {
      setState({ status: 'connected', email: data.data.email, lastSyncAt: null })
      setError(null)
      setPopupOpen(false)
    } else if (data.type === 'microsoft-oauth-error') {
      setError(data.error ?? 'Failed to connect Outlook.')
      setPopupOpen(false)
    }
  }, [])

  useEffect(() => {
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [handleMessage])

  function startOAuth(): void {
    setError(null)
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      response_mode: 'query',
      scope: MS_SCOPES,
      prompt: 'select_account',
    })
    const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`
    const width = 500
    const height = 640
    const left = window.screenX + (window.outerWidth - width) / 2
    const top = window.screenY + (window.outerHeight - height) / 2
    setPopupOpen(true)
    const popup = window.open(
      authUrl,
      'microsoft-oauth',
      `width=${width},height=${height},left=${left},top=${top},popup=yes`,
    )
    if (!popup) {
      setPopupOpen(false)
      setError('Popup blocked. Please allow popups for this site and try again.')
    }
  }

  async function disconnect(): Promise<void> {
    setDisconnecting(true)
    setError(null)
    try {
      await fetch('/api/email/account?provider=microsoft', {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      setState({ status: 'disconnected', email: null, lastSyncAt: null })
    } catch {
      setError('Failed to disconnect.')
    } finally {
      setDisconnecting(false)
    }
  }

  // No Azure app registered yet → show the operator setup instructions.
  if (!configured) {
    return <MicrosoftSetupCard />
  }

  if (state.status === 'connected') {
    return (
      <div className={cn('flex flex-col gap-2', className)}>
        <div className="flex flex-wrap items-center gap-3.5 rounded-xl border bg-card px-[18px] py-[18px]">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-ai-subtle text-ai">
            <Mail className="size-[19px]" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-semibold text-foreground">Outlook connected</p>
            {state.email ? (
              <p className="truncate text-xs text-muted-foreground">
                {state.email} · sending &amp; sync enabled
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={disconnect}
            disabled={disconnecting}
          >
            <Unplug className="size-3.5" aria-hidden="true" />
            <span>{disconnecting ? 'Disconnecting…' : 'Disconnect'}</span>
          </Button>
        </div>
        {error ? <p role="alert" className="text-sm text-danger-foreground">{error}</p> : null}
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-col gap-2 rounded-md border border-dashed bg-card px-4 py-5">
        <div className="flex items-center gap-2">
          <Mail className="size-5 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">
            Connect your Outlook / Microsoft 365 mailbox
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          Send and sync email from Outlook via Microsoft Graph. Your OAuth
          tokens are encrypted at rest.
        </p>
        <div className="mt-2">
          <Button type="button" size="sm" onClick={startOAuth} disabled={popupOpen}>
            {popupOpen ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                <span>Waiting for Microsoft…</span>
              </>
            ) : (
              <>
                <Mail className="size-3.5" aria-hidden="true" />
                <span>Connect Outlook</span>
              </>
            )}
          </Button>
        </div>
      </div>
      {error ? <p role="alert" className="text-sm text-danger-foreground">{error}</p> : null}
    </div>
  )
}
