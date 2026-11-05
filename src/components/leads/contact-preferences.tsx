'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useWorkspaceIdentity } from '@/components/layout/workspace-identity'
import { contactPreferences, type ContactPreferences } from '@/lib/contact-preferences'
import { followUpHeaders, type FollowUpContext } from '@/lib/follow-up-access'
import { followUpAccessLost, followUpData } from '@/lib/follow-up-client'

export function ContactPreferencesPanel({ leadId, context }: { leadId: string; context: FollowUpContext }): React.JSX.Element {
  const identity = useWorkspaceIdentity(), captured = useRef({ leadId, context }), epoch = useRef(0), mounted = useRef(true), valid = useRef(true)
  const changed = leadId !== captured.current.leadId || context.organizationId !== captured.current.context.organizationId || context.userId !== captured.current.context.userId || Boolean(identity && (identity.organizationId !== captured.current.context.organizationId || identity.userId !== captured.current.context.userId))
  const [data, setData] = useState<ContactPreferences | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [revoked, setRevoked] = useState(false), [uncertain, setUncertain] = useState(false)
  const [selection, setSelection] = useState<{ email: string; action: 'block' | 'unblock'; version: string } | null>(null), [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const reasonId = useId()
  const revoke = useCallback(() => { valid.current = false; epoch.current++; setRevoked(true); setData(null); setSelection(null); setReason(''); setConfirmed(false); setError(''); setNotice('') }, [])
  const load = useCallback(async () => {
    if (!valid.current) return
    const version = ++epoch.current, initial = captured.current
    setLoading(true); setError(''); setNotice('')
    try {
      const result = await followUpData<unknown>(await fetch(`/api/leads/${initial.leadId}/contact-preferences`, { cache: 'no-store', headers: followUpHeaders(initial.context) }), initial.context)
      if (!mounted.current || !valid.current || version !== epoch.current) return
      setData(contactPreferences.parse(result.data)); setSelection(null); setReason(''); setConfirmed(false); setUncertain(false)
    } catch (cause) {
      if (!mounted.current || !valid.current || version !== epoch.current) return
      if (followUpAccessLost(cause)) { revoke(); return }
      setUncertain(true); setError(cause instanceof Error ? cause.message : 'Contact preferences are unavailable. Refresh the status.')
    } finally { if (mounted.current && version === epoch.current) setLoading(false) }
  }, [revoke])
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false } }, [load])
  useEffect(() => { if (changed) revoke() }, [changed, revoke])

  function review(email: string, blocked: boolean): void {
    if (!data || !valid.current || loading || busy || uncertain || !data.canBlock || blocked && !data.canUnblock) return
    setSelection({ email, action: blocked ? 'unblock' : 'block', version: data.version }); setReason(''); setConfirmed(false); setError(''); setNotice('')
  }
  async function save(): Promise<void> {
    if (!selection || !data || !confirmed || reason.trim().length < 3 || uncertain || busy || changed || !valid.current) return
    const version = ++epoch.current, initial = captured.current
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await followUpData<unknown>(await fetch(`/api/leads/${initial.leadId}/contact-preferences`, { method: 'POST', headers: { 'content-type': 'application/json', ...followUpHeaders(initial.context) }, body: JSON.stringify({ action: selection.action, email: selection.email, reason: reason.trim(), expectedVersion: selection.version, confirmed: true }) }), initial.context)
      if (!mounted.current || !valid.current || version !== epoch.current) return
      setData(contactPreferences.parse(result.data)); setSelection(null); setReason(''); setConfirmed(false); setNotice('Contact preference saved. Stopped cadences stay stopped.')
    } catch (cause) {
      if (!mounted.current || !valid.current || version !== epoch.current) return
      if (followUpAccessLost(cause)) { revoke(); return }
      setUncertain(true); setConfirmed(false); setError(cause instanceof Error ? cause.message : 'The change could not be confirmed. Refresh the status before another review.')
    } finally { if (mounted.current && version === epoch.current) setBusy(false) }
  }

  if (revoked || changed) return <section aria-label="Contact preferences"><p role="alert">Access changed. Reload before continuing.</p></section>
  const blocked = data?.addresses.some(row => row.blocked)
  return <section aria-label="Contact preferences" aria-busy={loading || busy} className="min-w-0 rounded-lg border bg-card p-[18px]">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold">Do not contact</h2><Button type="button" variant="outline" size="sm" disabled={loading || busy} onClick={() => void load()}>Refresh status</Button></div>
    <p className="mt-2 text-sm text-muted-foreground">These controls block email outreach and stop active or paused cadences. A shared address is blocked across this workspace, including duplicate and merged leads. Phone and SMS controls are separate.</p>
    {loading && !data ? <p className="mt-3 text-sm" role="status">Loading contact preferences…</p> : data && <>
      <p className="mt-3 text-sm font-medium">{blocked ? 'Email outreach is blocked for this lead.' : 'No listed email address is blocked.'}</p>
      {data.addresses.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Add a valid email address to this lead before reviewing contact restrictions.</p> : <ul className="mt-3 grid min-w-0 gap-3">{data.addresses.map(row => <li key={row.email} className="min-w-0 rounded-md border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 break-all text-sm font-medium">{row.email}</span><span className="text-xs">{row.blocked ? 'Do not contact' : 'Not blocked'}</span></div>
        {row.reason && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">Last change: {row.reason}</p>}
        {row.updatedAt && <p className="mt-1 text-xs text-muted-foreground">Updated <time dateTime={row.updatedAt}>{new Date(row.updatedAt).toLocaleString()}</time>. Actor and reason are recorded in audit history.</p>}
        {data.canBlock && (!row.blocked || data.canUnblock) && <Button type="button" className="mt-3 max-w-full whitespace-normal break-all" size="sm" variant="outline" disabled={loading || busy || uncertain} onClick={() => review(row.email, row.blocked)}>{row.blocked ? `Review clearing ${row.email}` : `Block ${row.email}`}</Button>}
      </li>)}</ul>}
      {!data.canBlock && <p className="mt-3 text-xs text-muted-foreground">You have read-only access to contact preferences.</p>}
      {blocked && !data.canUnblock && <p className="mt-3 text-xs text-muted-foreground">Ask a user with lead deletion permission to review clearing a restriction.</p>}
    </>}
    {selection && <form aria-label="Review contact preference" className="mt-4 grid gap-3 rounded-md border p-3" onSubmit={event => { event.preventDefault(); void save() }}>
      <p className="break-all text-sm font-medium">{selection.action === 'block' ? 'Block email outreach for' : 'Review clearing the restriction for'} {selection.email}</p>
      {selection.action === 'unblock' && <p className="text-sm text-muted-foreground">Clear only after reviewing the person&apos;s renewed contact request. Clearing never restarts a stopped cadence.</p>}
      <label htmlFor={reasonId} className="grid gap-1.5 text-sm">Reason<textarea id={reasonId} value={reason} onChange={event => setReason(event.target.value)} minLength={3} maxLength={1000} disabled={busy} required rows={3} className="w-full rounded-md border bg-background px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy || uncertain} />I reviewed this address and its effect across this workspace.</label>
      {uncertain && <p className="text-sm">Refresh the status before starting another review. No change is retried automatically.</p>}
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy || loading || uncertain || !confirmed || reason.trim().length < 3}>{busy ? 'Saving…' : selection.action === 'block' ? 'Confirm block' : 'Confirm clearing restriction'}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => { setSelection(null); setReason(''); setConfirmed(false) }}>Cancel review</Button></div>
    </form>}
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="mt-3 text-sm">{notice}</p>}
  </section>
}
