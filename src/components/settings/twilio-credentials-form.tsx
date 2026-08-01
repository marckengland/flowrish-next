'use client'

import { useEffect, useState } from 'react'
import { Check, Copy, Loader2, Unplug } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface VoiceConfigView {
  configured: boolean
  twilioAccountSid: string | null
  twilioApiKeySid: string | null
  twilioTwimlAppSid: string | null
  twilioCallerId: string | null
  hasApiKeySecret: boolean
  hasAuthToken: boolean
}

/**
 * In-app form for an org's OWN Twilio credentials (bring-your-own).
 *
 * The API Key Secret is write-only: it's sent to the server (encrypted at
 * rest) but never returned. Leaving it blank on a later save keeps the
 * stored secret. The webhook URL to paste into the TwiML App is shown too.
 */
export function TwilioCredentialsForm(): React.JSX.Element {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [configured, setConfigured] = useState(false)
  const [hasSecret, setHasSecret] = useState(false)

  const [accountSid, setAccountSid] = useState('')
  const [apiKeySid, setApiKeySid] = useState('')
  const [apiKeySecret, setApiKeySecret] = useState('')
  const [twimlAppSid, setTwimlAppSid] = useState('')
  const [callerId, setCallerId] = useState('')
  const [authToken, setAuthToken] = useState('')
  const [hasAuthToken, setHasAuthToken] = useState(false)

  const [webhookUrl, setWebhookUrl] = useState('/api/voice/twiml')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setWebhookUrl(`${window.location.origin}/api/voice/twiml`)
    }
    let cancelled = false
    fetch('/api/admin/voice-config', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled || !body?.config) return
        const c = body.config as VoiceConfigView
        setConfigured(c.configured)
        setHasSecret(c.hasApiKeySecret)
        setHasAuthToken(c.hasAuthToken)
        setAccountSid(c.twilioAccountSid ?? '')
        setApiKeySid(c.twilioApiKeySid ?? '')
        setTwimlAppSid(c.twilioTwimlAppSid ?? '')
        setCallerId(c.twilioCallerId ?? '')
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    setSaved(false)
    setSaving(true)
    try {
      const res = await fetch('/api/admin/voice-config', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          twilioAccountSid: accountSid,
          twilioApiKeySid: apiKeySid,
          // Only send secrets when the user typed one.
          twilioApiKeySecret: apiKeySecret || undefined,
          twilioTwimlAppSid: twimlAppSid,
          twilioCallerId: callerId,
          twilioAuthToken: authToken || undefined,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        config?: VoiceConfigView
        error?: { message?: string }
      }
      if (!res.ok || !body.config) {
        setError(body.error?.message ?? 'Could not save credentials.')
        return
      }
      setConfigured(body.config.configured)
      setHasSecret(body.config.hasApiKeySecret)
      setHasAuthToken(body.config.hasAuthToken)
      setApiKeySecret('')
      setAuthToken('')
      setSaved(true)
    } catch {
      setError('Could not save credentials.')
    } finally {
      setSaving(false)
    }
  }

  async function disconnect(): Promise<void> {
    setError(null)
    setDisconnecting(true)
    try {
      await fetch('/api/admin/voice-config', {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      setConfigured(false)
      setHasSecret(false)
      setHasAuthToken(false)
      setAccountSid('')
      setApiKeySid('')
      setApiKeySecret('')
      setTwimlAppSid('')
      setCallerId('')
      setAuthToken('')
      setSaved(false)
    } catch {
      setError('Could not disconnect.')
    } finally {
      setDisconnecting(false)
    }
  }

  async function copyWebhook(): Promise<void> {
    try {
      await navigator.clipboard.writeText(webhookUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  return (
    <Card className="max-w-[620px]">
      <CardHeader>
        <CardTitle>Connect your Twilio account</CardTitle>
        {configured ? (
          <Badge variant="brand" size="sm">
            <Check className="size-3" aria-hidden="true" />
            Connected
          </Badge>
        ) : (
          <Badge variant="outline" size="sm">
            Not connected
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-[13px] text-muted-foreground">
          Enter your own Twilio credentials — they&apos;re stored encrypted and
          used only for your workspace. The API Key Secret is never shown again
          after saving.
        </p>

        {/* Webhook URL to paste into the TwiML App */}
        <div className="mb-4 rounded-[10px] border bg-background/60 p-3">
          <p className="mb-1.5 text-[12px] font-medium text-foreground">
            TwiML App “Voice Request URL” — paste this in Twilio:
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 font-mono text-[12px] text-foreground">
              {webhookUrl}
            </code>
            <Button type="button" variant="outline" size="sm" onClick={copyWebhook}>
              {copied ? (
                <>
                  <Check className="size-3.5" aria-hidden="true" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="size-3.5" aria-hidden="true" />
                  Copy
                </>
              )}
            </Button>
          </div>
        </div>

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading…
          </p>
        ) : (
          <form onSubmit={save} className="flex flex-col gap-3">
            <Field
              id="tw-account-sid"
              label="Account SID"
              placeholder="AC…"
              value={accountSid}
              onChange={setAccountSid}
            />
            <Field
              id="tw-api-key-sid"
              label="API Key SID"
              placeholder="SK…"
              value={apiKeySid}
              onChange={setApiKeySid}
            />
            <Field
              id="tw-api-key-secret"
              label={
                hasSecret
                  ? 'API Key Secret (leave blank to keep saved secret)'
                  : 'API Key Secret'
              }
              placeholder={hasSecret ? '•••••••• saved' : 'Shown once in Twilio'}
              value={apiKeySecret}
              onChange={setApiKeySecret}
              type="password"
            />
            <Field
              id="tw-twiml-app-sid"
              label="TwiML App SID"
              placeholder="AP…"
              value={twimlAppSid}
              onChange={setTwimlAppSid}
            />
            <Field
              id="tw-caller-id"
              label="Caller ID (your Twilio number)"
              placeholder="+14155551234"
              value={callerId}
              onChange={setCallerId}
            />
            <div>
              <Field
                id="tw-auth-token"
                label={
                  hasAuthToken
                    ? 'Auth Token (recommended · leave blank to keep saved token)'
                    : 'Auth Token (recommended)'
                }
                placeholder={hasAuthToken ? '•••••••• saved' : 'Verifies inbound call webhooks'}
                value={authToken}
                onChange={setAuthToken}
                type="password"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Found on the Twilio Console dashboard. When set, Flowrish
                verifies each call webhook&apos;s signature so only Twilio can
                trigger calls on your account.
              </p>
            </div>

            {error && <p className="text-[13px] text-destructive">{error}</p>}
            {saved && (
              <p className="text-[13px] text-brand-emphasis">
                Saved. Reps can now call from the browser on lead pages.
              </p>
            )}

            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Saving…
                  </>
                ) : (
                  'Save credentials'
                )}
              </Button>
              {configured && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={disconnect}
                  disabled={disconnecting}
                >
                  <Unplug className="size-3.5" aria-hidden="true" />
                  {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                </Button>
              )}
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

function Field({
  id,
  label,
  placeholder,
  value,
  onChange,
  type = 'text',
}: {
  id: string
  label: string
  placeholder?: string
  value: string
  onChange: (v: string) => void
  type?: string
}): React.JSX.Element {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[13px] font-medium text-foreground">
        {label}
      </label>
      {type === 'password' ? (
        <PasswordInput
          id={id}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
        />
      ) : (
        <Input
          id={id}
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
        />
      )}
    </div>
  )
}
