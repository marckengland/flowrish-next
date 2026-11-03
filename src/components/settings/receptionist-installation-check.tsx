'use client'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { installationGuidance, installationInputSchema, installationResultSchema, type InstallationResult } from '@/lib/receptionist-installation'
import type { WebsiteReceptionistSettings } from '@/lib/website-receptionist'

export function ReceptionistInstallationCheck({ settings }: { settings: WebsiteReceptionistSettings }): React.JSX.Element {
  const [url, setUrl] = useState(() => settings.allowedOrigins[0] ? `${settings.allowedOrigins[0]}/` : ''), [result, setResult] = useState<InstallationResult | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const active = useRef(true), pending = useRef<AbortController | null>(null)
  useEffect(() => { active.current = true; setResult(null); setError(''); setBusy(false); return () => { active.current = false; pending.current?.abort(); pending.current = null } }, [settings.publicId, settings.updatedAt])
  function edited(next: string) { pending.current?.abort(); pending.current = null; setUrl(next); setResult(null); setError(''); setBusy(false) }
  async function check() {
    if (pending.current || !settings.allowedOrigins.length) return
    const input = installationInputSchema.safeParse({ url, expectedUpdatedAt: settings.updatedAt })
    if (!input.success) { setResult(null); setError('Enter a public HTTPS page URL without credentials, query, fragment, or a custom port.'); return }
    const request = new AbortController(); pending.current = request; setBusy(true); setError(''); setResult(null)
    let failure = 'Website installation check is unavailable. Reload saved setup and try again.'
    try {
      const response = await fetch('/api/admin/receptionist/setup/installation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify(input.data), signal: request.signal })
      if (!response.ok) { failure = response.status === 409 ? 'Reload saved setup before checking again. The saved websites or widget settings changed.' : response.status === 429 ? 'Wait 30 seconds before checking this organization again.' : response.status === 403 ? 'Current organization administrator access is required.' : 'Website installation check is unavailable. Try again later.'; throw new Error('Check failed') }
      const next = installationResultSchema.parse((await response.json()).data)
      if (next.requestedUrl !== input.data.url || next.expectedUpdatedAt !== settings.updatedAt || next.publicId !== settings.publicId || next.originAllowed !== settings.allowedOrigins.includes(new URL(input.data.url).origin) || next.checkedUrl && !settings.allowedOrigins.includes(new URL(next.checkedUrl).origin)) throw new Error('Website installation check is unavailable. Reload saved setup and try again.')
      if (active.current && !request.signal.aborted && pending.current === request) setResult(next)
    } catch {
      if (active.current && !request.signal.aborted && pending.current === request) setError(failure)
    } finally { if (pending.current === request) { pending.current = null; if (active.current && !request.signal.aborted) setBusy(false) } }
  }
  return <section aria-label="Website installation checker" className="space-y-3 rounded-lg border bg-card p-4">
    <h3 className="font-semibold">Check website installation</h3><p className="text-sm text-muted-foreground">Check the public page source for this organization’s standard script tag. This does not enable reception, load the widget, send an AI message, or place a call.</p>
    <form aria-label="Website installation check" className="space-y-3" onSubmit={event => { event.preventDefault(); void check() }}>
      <label className="grid gap-1 text-sm font-medium">Public website page URL<input type="url" required maxLength={2000} autoComplete="url" className="min-h-11 min-w-0 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={url} onChange={event => { edited(event.target.value) }} placeholder="https://your-business.example/services" /></label>
      <Button className="min-h-11" type="submit" disabled={busy || !settings.allowedOrigins.length}>{busy ? 'Checking public page…' : 'Check website installation'}</Button>
    </form>
    {!settings.allowedOrigins.length && <p className="text-sm">Save an exact website origin in Website &amp; budget, then reload saved setup before checking.</p>}
    <p className="text-xs text-muted-foreground">Saved allowed websites: <span className="break-all">{settings.allowedOrigins.join(', ') || 'None'}</span>. One check per organization every 30 seconds; public HTML only, at most 512 KiB and eight seconds of website request time.</p>
    {busy && <p role="status" className="text-sm">Reading the public page source. You can edit the URL or leave to cancel.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {result && <div role="status" aria-atomic="true" className="space-y-2 rounded-md border p-3"><h4 className="text-sm font-semibold">{installationGuidance[result.outcome].title}</h4><p className="text-sm text-muted-foreground">{installationGuidance[result.outcome].detail}</p><p className="break-all text-xs text-muted-foreground">{result.checkedUrl ?? result.requestedUrl}</p><p className="text-xs text-muted-foreground">Checked {new Date(result.checkedAt).toLocaleString()}. Receptionist snippets: {result.detectedSnippets}; matching: {result.matchingSnippets}. Results are not saved.</p></div>}
  </section>
}
