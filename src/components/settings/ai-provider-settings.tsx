'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  AI_PROVIDERS,
  DEFAULT_AI_LIMITS,
  aiProviderSettingsSchema,
  type AiProvider,
  type AiProviderConfigView,
  type AiProviderSettingsView,
} from '@/lib/ai-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

const limitFields = [
  { name: 'dailyRequestLimit', label: 'Daily request limit', min: 1, max: 1000 },
  { name: 'dailyTokenLimit', label: 'Daily reserved token limit', min: 1000, max: 10000000 },
  { name: 'maxOutputTokens', label: 'Maximum output tokens', min: 128, max: 4096 },
  { name: 'maxInputBytes', label: 'Maximum input bytes', min: 1000, max: 64000 },
] as const

type LimitField = (typeof limitFields)[number]['name']
type ProviderDraft = { provider: AiProvider; model: string; enabled: boolean } & Record<LimitField, string>

function draftFrom(config: AiProviderConfigView | null): ProviderDraft {
  const limits = config ?? DEFAULT_AI_LIMITS
  return {
    provider: config?.provider ?? 'deepseek',
    model: config?.model ?? AI_PROVIDERS.deepseek.defaultModel,
    enabled: config?.enabled ?? true,
    dailyRequestLimit: String(limits.dailyRequestLimit),
    dailyTokenLimit: String(limits.dailyTokenLimit),
    maxOutputTokens: String(limits.maxOutputTokens),
    maxInputBytes: String(limits.maxInputBytes),
  }
}

function requestError(status: number, fallback: string): string {
  if (status === 403) return 'Only organization administrators can manage AI provider settings.'
  if (status === 401) return 'Sign in again to manage AI provider settings.'
  if (status === 409) return 'These settings changed in another session. Reload the saved settings before continuing.'
  if (status === 429) return 'The AI usage limit has been reached. Try again after the limit resets.'
  return fallback
}

export function AiProviderSettings(): React.JSX.Element {
  const [view, setView] = useState<AiProviderSettingsView | null>(null)
  const [draft, setDraft] = useState<ProviderDraft | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [busy, setBusy] = useState<'save' | 'test' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [invalidField, setInvalidField] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [accessDenied, setAccessDenied] = useState(false)
  const mounted = useRef(false)
  const pending = useRef<AbortController | null>(null)
  const keyInput = useRef<HTMLInputElement>(null)
  const errorSummary = useRef<HTMLDivElement>(null)
  const captureKeyInput = useCallback((input: HTMLInputElement | null) => {
    if (!input && keyInput.current) keyInput.current.value = ''
    keyInput.current = input
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      pending.current?.abort()
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    setLoading(true)
    setView(null)
    setDraft(null)
    setApiKey('')
    setError(null)
    setInvalidField(null)
    setNotice(null)
    setConflict(false)
    setAccessDenied(false)

    async function load(): Promise<void> {
      try {
        const res = await fetch('/api/admin/ai-provider', {
          credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
          headers: { Accept: 'application/json' },
        })
        if (cancelled) return
        if (!res.ok) {
          setError(requestError(res.status, 'Could not load AI provider settings.'))
          setAccessDenied(res.status === 403 || res.status === 401)
          return
        }
        const body = await res.json() as { data?: AiProviderSettingsView }
        if (cancelled) return
        if (!body.data) throw new Error('Invalid response')
        setView(body.data)
        setDraft(draftFrom(body.data.config))
      } catch {
        if (!cancelled) setError('Could not load AI provider settings.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true; controller.abort() }
  }, [loadAttempt])

  useEffect(() => { if (error) errorSummary.current?.focus() }, [error])

  const dirty = !!draft && !!view && (apiKey !== '' || JSON.stringify(draft) !== JSON.stringify(draftFrom(view.config)))
  const isDeepSeekFlash = draft?.provider === 'deepseek' && draft.model === 'deepseek-flash'
  const requiresKey = !view?.config?.hasKey || view.config.provider !== draft?.provider
  const locked = loading || !!busy || conflict || accessDenied
  const canTest = !!view?.config?.enabled && view.config.hasKey && !dirty && !locked

  function edit(update: Partial<ProviderDraft>): void {
    setDraft((current) => current ? { ...current, ...update } : current)
    setNotice(null)
    setError(null)
    setInvalidField(null)
  }

  function recordFailure(status: number, fallback: string): void {
    setError(requestError(status, fallback))
    setConflict(status === 409)
    setAccessDenied(status === 403 || status === 401)
  }

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!draft || !view || locked || pending.current) return
    setNotice(null)
    setError(null)
    setInvalidField(null)
    if (requiresKey && !apiKey.trim()) {
      setError('Enter an API key before saving this provider.')
      setInvalidField('apiKey')
      return
    }
    const parsed = aiProviderSettingsSchema.safeParse({
      ...draft,
      dailyRequestLimit: Number(draft.dailyRequestLimit),
      dailyTokenLimit: Number(draft.dailyTokenLimit),
      maxOutputTokens: Number(draft.maxOutputTokens),
      maxInputBytes: Number(draft.maxInputBytes),
      apiKey,
      expectedUpdatedAt: view.config?.updatedAt ?? null,
    })
    if (!parsed.success) {
      const field = String(parsed.error.issues[0]?.path[0] ?? '')
      const limit = limitFields.find((item) => item.name === field)
      setError(limit ? `${limit.label} must be a whole number from ${limit.min.toLocaleString('en-US')} to ${limit.max.toLocaleString('en-US')}.`
        : field === 'apiKey' ? 'Enter a valid API key without whitespace (up to 500 characters).'
          : 'Enter a valid model identifier.')
      setInvalidField(field)
      return
    }
    const controller = new AbortController()
    pending.current = controller
    setBusy('save')
    setApiKey('')
    try {
      const res = await fetch('/api/admin/ai-provider', {
        method: 'PUT', credentials: 'same-origin', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(parsed.data),
      })
      if (!mounted.current) return
      if (!res.ok) { recordFailure(res.status, 'Could not save AI provider settings.'); return }
      const body = await res.json() as { data?: AiProviderSettingsView }
      if (!mounted.current) return
      if (!body.data?.config) throw new Error('Invalid response')
      setView(body.data)
      setDraft(draftFrom(body.data.config))
      setNotice('AI provider settings saved. Changes apply immediately; no redeploy is needed.')
    } catch {
      if (mounted.current) setError('Could not save AI provider settings.')
    } finally {
      pending.current = null
      if (mounted.current) setBusy(null)
    }
  }

  async function testConnection(): Promise<void> {
    if (!canTest || !view?.config || pending.current) return
    const controller = new AbortController()
    pending.current = controller
    setBusy('test')
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/admin/ai-provider/test', {
        method: 'POST', credentials: 'same-origin', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ expectedUpdatedAt: view.config.updatedAt }),
      })
      if (!mounted.current) return
      if (!res.ok) { recordFailure(res.status, 'Connection test failed. Check the saved provider, model, key, and usage limits.'); return }
      const body = await res.json() as { data?: { ok?: boolean } }
      if (!mounted.current) return
      if (body.data?.ok !== true) throw new Error('Invalid response')
      setNotice('Connection test succeeded.')
    } catch {
      if (mounted.current) setError('Connection test failed. Check the saved provider, model, key, and usage limits.')
    } finally {
      pending.current = null
      if (mounted.current) setBusy(null)
    }
  }

  const errors = error && (
    <div ref={errorSummary} role="alert" tabIndex={-1} className="rounded-md border border-danger/30 p-3 text-[13px] text-danger-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {invalidField ? <a href={`#ai-${invalidField}`}>{error}</a> : error}
      {conflict && <p className="mt-1 text-muted-foreground">Reloading discards unsaved edits. The entered key has been cleared.</p>}
    </div>
  )

  return (
    <div className="flex max-w-[620px] flex-col gap-[18px]">
      <Card>
        <CardHeader><CardTitle>Organization AI provider</CardTitle></CardHeader>
        <CardContent>
          <p className="mb-4 text-[13px] text-muted-foreground">Choose the provider used by your organization. Keys are stored encrypted and are never shown after saving. Changes apply immediately without a redeploy.</p>
          {loading ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Loading AI provider settings…</p> : !view || !draft ? (
            <div className="flex flex-col gap-3">{errors}{!accessDenied && <Button type="button" variant="outline" size="sm" onClick={() => setLoadAttempt((value) => value + 1)}>Try again</Button>}</div>
          ) : (
            <form onSubmit={save} noValidate className="flex flex-col gap-4">
              {errors}
              {notice && <p role="status" className="text-[13px] text-brand-emphasis">{notice}</p>}
              <p className="rounded-md bg-muted/50 p-3 text-[13px] text-muted-foreground">
                {!view.config ? view.platformAvailable
                  ? 'Platform AI is available while no organization provider is configured.'
                  : 'Platform AI is unavailable. Save an organization provider to use AI.'
                  : view.config.enabled ? 'Organization AI is enabled. Failed requests never fall back to platform credentials.'
                    : 'Organization AI is paused. The saved configuration is kept, and platform credentials will not be used.'}
              </p>
              <fieldset disabled={locked} className="flex min-w-0 flex-col gap-4">
                <legend className="sr-only">AI provider configuration</legend>
                <div>
                  <label htmlFor="ai-provider" className="mb-1.5 block text-[13px] font-medium">Provider</label>
                  <select id="ai-provider" value={draft.provider} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" onChange={(event) => {
                    const provider = event.target.value as AiProvider
                    setApiKey('')
                    edit({ provider, model: AI_PROVIDERS[provider].defaultModel })
                  }}>
                    {Object.entries(AI_PROVIDERS).map(([provider, details]) => <option key={provider} value={provider}>{details.label}</option>)}
                  </select>
                  <p className="mt-1 break-all text-xs text-muted-foreground">Fixed endpoint: {AI_PROVIDERS[draft.provider].baseUrl}</p>
                </div>
                <div>
                  <label htmlFor="ai-model" className="mb-1.5 block text-[13px] font-medium">Model</label>
                  {isDeepSeekFlash && <p id="ai-model-name" className="mb-1.5 text-sm font-medium">DeepSeek V4.1 Flash</p>}
                  <Input id="ai-model" aria-describedby={isDeepSeekFlash ? 'ai-model-name ai-model-help' : 'ai-model-help'} value={draft.model} maxLength={128} autoComplete="off" spellCheck={false} aria-invalid={invalidField === 'model'} onChange={(event) => edit({ model: event.target.value })} />
                  <p id="ai-model-help" className="mt-1 text-xs text-muted-foreground">This field stores the API model identifier. Use a model available to your provider account.{draft.provider === 'openai' ? ' Enter your OpenAI model identifier.' : ''}</p>
                </div>
                <div>
                  <label htmlFor="ai-apiKey" className="mb-1.5 block text-[13px] font-medium">API key</label>
                  <Input ref={captureKeyInput} id="ai-apiKey" type="password" autoComplete="new-password" autoCapitalize="none" spellCheck={false} maxLength={500} value={apiKey} aria-invalid={invalidField === 'apiKey'} aria-describedby="ai-key-help" onChange={(event) => { setApiKey(event.target.value); edit({}) }} />
                  <p id="ai-key-help" className="mt-1 text-xs text-muted-foreground">{requiresKey ? 'Enter a new key for this provider.' : 'Leave blank to keep the saved key for this provider.'} The field is cleared after a save attempt or a provider change.</p>
                </div>
                <div>
                  <label htmlFor="ai-enabled" className="flex items-start gap-2 text-[13px] font-medium">
                    <input id="ai-enabled" type="checkbox" checked={draft.enabled} aria-describedby="ai-enabled-help" onChange={(event) => edit({ enabled: event.target.checked })} className="mt-0.5 size-4 accent-brand" />
                    Enable organization AI
                  </label>
                  <p id="ai-enabled-help" className="mt-1 text-xs text-muted-foreground">Turn off to pause AI while keeping your saved provider. Pausing prevents platform fallback.</p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {limitFields.map((field) => <div key={field.name}>
                    <label htmlFor={`ai-${field.name}`} className="mb-1.5 block text-[13px] font-medium">{field.label}</label>
                    <Input id={`ai-${field.name}`} type="number" min={field.min} max={field.max} step={1} inputMode="numeric" value={draft[field.name]} aria-invalid={invalidField === field.name} onChange={(event) => edit({ [field.name]: event.target.value })} />
                  </div>)}
                </div>
              </fieldset>
              <p className="text-xs text-muted-foreground">Each request reserves an input-byte upper bound plus its maximum output tokens. Reservations are never refunded, including failed or interrupted requests. These application limits are not a dollar billing cap.</p>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" disabled={locked || !dirty}>{busy === 'save' ? 'Saving…' : 'Save AI provider'}</Button>
                {conflict && <Button type="button" size="sm" variant="outline" onClick={() => setLoadAttempt((value) => value + 1)}>Reload saved settings</Button>}
              </div>
              <div className="border-t pt-4">
                <p id="ai-test-help" className="mb-3 text-[13px] text-muted-foreground">A connection test makes one request and counts toward your organization limits and provider usage. Save changes and enable AI before testing. Saving never tests automatically.</p>
                <Button type="button" variant="outline" size="sm" disabled={!canTest} aria-describedby="ai-test-help" onClick={() => void testConnection()}>{busy === 'test' ? 'Testing…' : 'Test saved connection'}</Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
      {view && <Card>
        <CardHeader><CardTitle>Today’s organization AI usage</CardTitle></CardHeader>
        <CardContent>
          <p className="mb-3 text-[13px] text-muted-foreground">{view.usage.day.slice(0, 10)} (UTC)</p>
          <dl className="grid grid-cols-1 gap-3 text-[13px] sm:grid-cols-2">
            {[
              ['Requests used', view.usage.requests], ['Reserved tokens used', view.usage.reservedTokens],
              ['Provider-reported tokens', view.usage.reportedTokens], ['Completed requests', view.usage.completedRequests],
              ['Failed requests', view.usage.failedRequests],
            ].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd aria-label={String(label)} className="mt-0.5 font-medium tabular-nums">{Number(value).toLocaleString('en-US')}</dd></div>)}
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">Provider-reported tokens are separate from reservations and may be unavailable for failed or interrupted requests. Pending requests are included in requests and reservations. Usage is refreshed when settings are loaded or saved.</p>
        </CardContent>
      </Card>}
    </div>
  )
}
