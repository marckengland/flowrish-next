'use client'
import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { EMAIL_MATCH_USER_HEADER, emailMatchListItem, emailMatchPreview, emailMatchResult, type EmailMatchAction, type EmailMatchPreview } from '@/lib/email-routing'
import { WORKSPACE_EVENT, WORKSPACE_HEADER } from '@/lib/workspace-context'
export interface EmailMatchContext { organizationId: string; userId: string }
type Item = z.infer<typeof emailMatchListItem>
class ReviewError extends Error { constructor(message: string, public status: number, public code: string) { super(message) } }
export function EmailMatchInbox(props: { context: EmailMatchContext; canWrite: boolean; onResolved: () => void }) {
  return <ScopedEmailMatches key={`${props.context.organizationId}:${props.context.userId}`} {...props} />
}
function ScopedEmailMatches({ context, canWrite, onResolved }: { context: EmailMatchContext; canWrite: boolean; onResolved: () => void }) {
  const [items, setItems] = useState<Item[]>([]), [preview, setPreview] = useState<EmailMatchPreview | null>(null)
  const [selected, setSelected] = useState(''), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [revoked, setRevoked] = useState(false)
  const [pending, setPending] = useState<{ id: string; body: EmailMatchAction } | null>(null)
  const live = useRef(true), active = useRef(false)
  function revoke() { live.current = false; setItems([]); setPreview(null); setPending(null); setRevoked(true); setError('Access changed. Reload to check the current account and business.'); setBusy(false); setLoading(false) }
  async function request(path: string, body?: unknown) {
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', headers: { [EMAIL_MATCH_USER_HEADER]: context.userId, [WORKSPACE_HEADER]: context.organizationId, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const value = await response.json()
    if (!response.ok) throw new ReviewError(value.error?.message ?? 'Unable to review email matches.', response.status, value.error?.code ?? '')
    if (value.scope?.organizationId !== context.organizationId || value.scope?.userId !== context.userId) throw new ReviewError('The review context changed.', 409, 'EMAIL_MATCH_CONTEXT_CHANGED')
    return value.data as unknown
  }
  function failed(cause: unknown) {
    if (cause instanceof ReviewError && ([401, 403].includes(cause.status) || /CONTEXT|WORKSPACE/.test(cause.code))) { revoke(); return }
    if (cause instanceof ReviewError && (cause.status === 404 || cause.code === 'EMAIL_SOURCE_CHANGED')) { setItems([]); setPreview(null); setPending(null) }
    setError(cause instanceof Error ? cause.message : 'Unable to review this message.')
  }
  async function load() {
    if (active.current || !live.current || pending) return
    active.current = true; setLoading(true); setError('')
    try { const data = z.array(emailMatchListItem).max(100).parse(await request('/api/email/matches')); if (live.current) { setItems(data); setPreview(null); setConfirmed(false); setSelected('') } }
    catch (cause) { if (live.current) failed(cause) }
    finally { active.current = false; if (live.current) setLoading(false) }
  }
  useEffect(() => {
    live.current = true; void load()
    const changed = () => revoke()
    window.addEventListener(WORKSPACE_EVENT, changed)
    return () => { live.current = false; window.removeEventListener(WORKSPACE_EVENT, changed) }
    // Context changes remount this component; refresh is an explicit action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  async function inspect(id: string) {
    if (active.current || pending || !live.current) return
    active.current = true; setBusy(true); setError(''); setPreview(null); setConfirmed(false); setSelected('')
    try { const data = emailMatchPreview.parse(await request(`/api/email/matches/${id}/preview`, {})); if (live.current) setPreview(data) }
    catch (cause) { if (live.current) failed(cause) }
    finally { active.current = false; if (live.current) setBusy(false) }
  }
  async function resolve(action: 'link' | 'dismiss', retry = false) {
    if (active.current || !canWrite || !preview || !live.current || !retry && (!confirmed || pending)) return
    const write = retry ? pending : { id: preview.message.id, body: { action, requestId: crypto.randomUUID(), expectedVersion: preview.version, confirmed: true as const, ...(action === 'link' ? { leadId: selected } : {}) } as EmailMatchAction }
    if (!write) return
    active.current = true; setBusy(true); setPending(write); setError('')
    try {
      const result = emailMatchResult.parse(await request(`/api/email/matches/${write.id}/resolve`, write.body))
      if (!live.current) return
      if (result.messageId !== write.id || result.requestId !== write.body.requestId || result.action !== write.body.action) throw new Error('The update response could not be verified. Retry the confirmed update.')
      setItems(rows => rows.filter(row => row.id !== write.id)); setPreview(null); setPending(null); setConfirmed(false); setSelected(''); setNotice(result.action === 'link' ? `Email linked. ${result.stopped} cadence enrollment(s) stopped. Any follow-up still needs approval.` : 'Match review dismissed. No email was sent.'); onResolved()
    } catch (cause) {
      if (!live.current) return
      if (cause instanceof ReviewError && [400, 404, 409, 410].includes(cause.status)) { setPending(null); setPreview(null) }
      failed(cause)
    } finally { active.current = false; if (live.current) setBusy(false) }
  }
  return <section aria-label="Email match reviews" aria-busy={loading || busy} className="min-w-0 rounded-xl border bg-card p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Email matches to review</h2><Button type="button" variant="outline" disabled={loading || busy || !!pending || revoked} onClick={() => void load()}>Refresh matches</Button></div>
    <p className="mt-2 text-sm text-muted-foreground">Conflicting addresses stay unlinked until reviewed. Linking may stop matching cadences; sending still requires approval.</p>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}{notice && <p role="status" className="mt-3 text-sm">{notice}</p>}
    {!revoked && <>{loading ? <p role="status" className="mt-3 text-sm">Loading email matches…</p> : items.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No email matches need review in your connected mailboxes.</p> : <ul className="mt-4 grid gap-3">{items.map(item => <li key={item.id} className="min-w-0 rounded-lg border p-3"><p className="break-words text-sm font-medium">{item.subject || '(No subject)'}</p><p className="mt-1 break-words text-xs text-muted-foreground">From {item.fromEmail} · Mailbox {item.mailboxEmail}</p><Button type="button" variant="outline" className="mt-2" disabled={busy || !!pending} onClick={() => void inspect(item.id)}>Review match</Button></li>)}</ul>}
    {preview && <div role="group" aria-label="Review email match" className="mt-4 grid min-w-0 gap-3 rounded-lg border p-4"><h3 className="break-words font-medium">{preview.message.subject || '(No subject)'}</h3><p className="whitespace-pre-wrap break-words text-sm">{preview.message.bodyPreview || 'No message preview available.'}</p>
      {preview.restrictedMatches && <p className="text-sm text-muted-foreground">Other matches are unavailable in your current access.</p>}{preview.blocked && <p className="text-sm text-muted-foreground">This address group needs administrator review. Linking is unavailable.</p>}
      <fieldset disabled={busy || !!pending || !canWrite} className="grid gap-2"><legend className="mb-2 text-sm font-medium">Choose the retained lead</legend>{preview.candidates.length === 0 && <p className="text-sm">No accessible candidate is available.</p>}{preview.candidates.map(candidate => <label key={candidate.id} className="flex items-start gap-2 rounded-md border p-3 text-sm"><input type="radio" name="email-match-lead" value={candidate.id} checked={selected === candidate.id} disabled={!candidate.canLink} onChange={() => setSelected(candidate.id)} className="mt-1" /><span className="min-w-0 break-words">{candidate.label}{candidate.email && <span className="block text-xs text-muted-foreground">{candidate.email}</span>}{candidate.viaArchive && <span className="block text-xs text-muted-foreground">Matches an archived address</span>}{!candidate.canLink && <span className="block text-xs">An existing association or invalid address group prevents linking.</span>}</span></label>)}</fieldset>
      {canWrite ? <><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy || !!pending} onChange={event => setConfirmed(event.target.checked)} className="mt-1" /><span>I reviewed the message and the selected lead. Linking may stop matching cadences and create a pending follow-up.</span></label><div className="flex flex-wrap gap-2"><Button type="button" disabled={busy || !!pending || !confirmed || !preview.candidates.some(row => row.id === selected && row.canLink)} onClick={() => void resolve('link')}>Confirm email match</Button><Button type="button" variant="outline" disabled={busy || !!pending || !confirmed} onClick={() => void resolve('dismiss')}>Dismiss match review</Button></div></> : <p className="text-sm text-muted-foreground">Read-only access. A mailbox owner with lead editing permission must confirm this review.</p>}
    </div>}
    {pending && !busy && <div className="mt-3"><p className="text-sm">The result is uncertain. Retry the same confirmed update before starting another.</p><Button type="button" className="mt-2" onClick={() => void resolve(pending.body.action, true)}>Retry confirmed update</Button></div>}
    <p className="mt-3 text-xs text-muted-foreground">Showing up to 100 recent reviews from your mailboxes. Candidate lists are limited to 20. This review does not generate a draft, create a task, or send an email.</p></>}
  </section>
}
