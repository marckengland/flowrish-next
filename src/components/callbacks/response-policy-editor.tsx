'use client'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { SETUP_HISTORY_EVENT } from '@/lib/receptionist-setup-history'
import { responsePolicyMetadataSchema, responsePolicyWriteSchema, supportedTarget, type BusinessHours, type ResponsePolicyMetadata } from '@/lib/callback-response'
type Draft = { enabled: boolean; handoffMinutes: string; attemptMinutes: string; backupUserId: string }
const draftOf = (data: ResponsePolicyMetadata): Draft => ({ enabled: data.policy.enabled, handoffMinutes: String(data.policy.handoffMinutes), attemptMinutes: String(data.policy.attemptMinutes), backupUserId: data.policy.backupUserId ?? '' })
const field = 'mt-1 min-h-11 w-full rounded-md border bg-background px-3 py-2 text-sm'
function schedule(hours: BusinessHours) { return `${hours.businessDays.map(day => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day]).join(', ')} · ${hours.opensAt}–${hours.closesAt} · ${hours.timeZone}` }
class RequestError extends Error { constructor(readonly status: number) { super('Request failed') } }
async function read(response: Response) { if (!response.ok) throw new RequestError(response.status); return responsePolicyMetadataSchema.parse((await response.json()).data) }

export function ResponsePolicyEditor(): React.JSX.Element {
  const [data, setData] = useState<ResponsePolicyMetadata | null>(null), [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false), [saving, setSaving] = useState(false), [acknowledged, setAcknowledged] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [navigation, setNavigation] = useState<string | null>(null)
  const mounted = useRef(true), pending = useRef<AbortController | null>(null), router = useRouter()
  const dirty = !!data && !!draft && JSON.stringify(draft) !== JSON.stringify(draftOf(data))
  const apply = useCallback((next: ResponsePolicyMetadata) => { setData(next); setDraft(draftOf(next)); setAcknowledged(false) }, [])
  const load = useCallback(async () => {
    if (pending.current) return
    const request = new AbortController(); pending.current = request; setBusy(true); setError(''); setNotice('')
    try { const next = await read(await fetch('/api/admin/callback-response-policy', { cache: 'no-store', signal: request.signal })); if (mounted.current && !request.signal.aborted) apply(next) }
    catch { if (mounted.current && !request.signal.aborted) setError('Unable to load response settings. Your edits are still here; reload to try again.') }
    finally { if (pending.current === request) pending.current = null; if (mounted.current && !request.signal.aborted) setBusy(false) }
  }, [apply])
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; pending.current?.abort(); pending.current = null } }, [load])
  useLayoutEffect(() => {
    if (!dirty && !saving) return
    const entry = { state: window.history.state, href: window.location.href }
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const links = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(anchor instanceof HTMLAnchorElement) || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || anchor.target === '_blank' || anchor.hasAttribute('download') || anchor.origin !== location.origin || anchor.href === location.href) return
      event.preventDefault(); event.stopPropagation()
      if (saving) setNotice('Wait for the policy save to finish before leaving.'); else setNavigation(anchor.pathname + anchor.search + anchor.hash)
    }
    const history = (bridge: Event) => {
      if (!saving && window.confirm('Discard unsaved response target settings and leave this page?')) return
      ;(bridge as CustomEvent<PopStateEvent>).detail.stopImmediatePropagation(); window.history.pushState(entry.state, '', entry.href)
    }
    window.addEventListener('beforeunload', unload); document.addEventListener('click', links, true); window.addEventListener(SETUP_HISTORY_EVENT, history)
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', links, true); window.removeEventListener(SETUP_HISTORY_EVENT, history) }
  }, [dirty, saving])
  function edit(value: Partial<Draft>) { setDraft(current => current ? { ...current, ...value } : current); setAcknowledged(false); setNotice(''); setError('') }
  async function save() {
    if (!data || !draft || pending.current) return
    const parsed = responsePolicyWriteSchema.safeParse({ enabled: draft.enabled, handoffMinutes: Number(draft.handoffMinutes), attemptMinutes: Number(draft.attemptMinutes), backupUserId: draft.backupUserId || null, expectedUpdatedAt: data.policy.updatedAt, expectedBusinessUpdatedAt: data.business.updatedAt, acknowledged })
    if (!parsed.success || draft.enabled && (!data.business.hours || !supportedTarget(data.business.hours, Number(draft.handoffMinutes)) || !supportedTarget(data.business.hours, Number(draft.attemptMinutes)) || !data.managers.some(row => row.id === draft.backupUserId))) { setError('Choose valid 5–1,440 minute targets, a current manager and valid saved business hours. Approve applying the enabled policy before saving.'); return }
    const request = new AbortController(); pending.current = request; setBusy(true); setSaving(true); setError(''); setNotice('')
    try {
      const next = await read(await fetch('/api/admin/callback-response-policy', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed.data), signal: request.signal }))
      if (next.policy.enabled !== parsed.data.enabled || next.policy.handoffMinutes !== parsed.data.handoffMinutes || next.policy.attemptMinutes !== parsed.data.attemptMinutes || next.policy.backupUserId !== parsed.data.backupUserId) throw new Error('Unexpected saved policy')
      if (mounted.current && !request.signal.aborted) { apply(next); setNotice('Response targets saved. The next scheduled check will refresh waiting deadlines.'); window.dispatchEvent(new Event('flowrish:callback-response-policy-changed')); window.dispatchEvent(new Event('flowrish:callback-notifications-changed')) }
    } catch (cause) { if (mounted.current && !request.signal.aborted) setError(cause instanceof RequestError && cause.status === 409 ? 'The saved policy or business hours changed. Reload to review the current values. Your edits have been kept.' : 'Unable to save response targets. Your edits have been kept; reload or try again.') }
    finally { if (pending.current === request) pending.current = null; if (mounted.current && !request.signal.aborted) { setBusy(false); setSaving(false) } }
  }
  return <section aria-label="Callback response policy" className="min-w-0 space-y-4 rounded-xl border bg-card p-4 sm:p-6">
    <h2 className="text-lg font-semibold">Business-hours response policy</h2><p className="text-sm text-muted-foreground">Opt in to separate targets for CRM handoff and the first recorded contact attempt. Escalation creates an in-app alert for your selected manager; staff still approve handoff and record contact themselves.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{notice && <p role="status" className="text-sm">{notice}</p>}{dirty && <p role="status" className="text-xs text-muted-foreground">Unsaved policy edits.</p>}
    {data && draft ? <form className="space-y-4" onSubmit={event => { event.preventDefault(); void save() }}><fieldset disabled={busy} className="min-w-0 space-y-4">
      <label className="flex min-h-11 items-center gap-2 text-sm font-medium"><input type="checkbox" checked={draft.enabled} disabled={!data.business.hours && !draft.enabled} onChange={event => edit({ enabled: event.target.checked })} />Enable callback response targets</label>
      <p className="text-xs text-muted-foreground">Saved policy: {data.policy.enabled ? 'Enabled' : 'Paused'} · Last successful target check: {data.policy.lastCheckedAt ? new Date(data.policy.lastCheckedAt).toLocaleString() : 'Not checked for this version yet'}</p>
      <div className="space-y-2 break-words rounded-md bg-muted/30 p-3 text-sm"><p className="font-medium">{data.business.businessName || 'Business hours'}</p>{data.business.hours ? <p>Current saved hours: {schedule(data.business.hours)}</p> : <p>Save valid weekly hours in <Link href="/settings?section=receptionist" className="underline">receptionist Settings</Link> before enabling.</p>}{data.policy.hours && <p>Policy snapshot: {schedule(data.policy.hours)}</p>}{data.hoursChanged && <p>Business hours have changed. Saving an enabled policy adopts the current hours and recalculates waiting deadlines.</p>}</div>
      <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm font-medium">CRM handoff target (business minutes)<input className={field} type="number" min={5} max={1440} step={1} value={draft.handoffMinutes} onChange={event => edit({ handoffMinutes: event.target.value })} /></label><label className="block text-sm font-medium">First contact target (business minutes)<input className={field} type="number" min={5} max={1440} step={1} value={draft.attemptMinutes} onChange={event => edit({ attemptMinutes: event.target.value })} /></label></div>
      <label className="block text-sm font-medium">Escalation manager<select className={field} value={draft.backupUserId} onChange={event => edit({ backupUserId: event.target.value })}><option value="">Choose a manager</option>{draft.backupUserId && !data.managers.some(row => row.id === draft.backupUserId) && <option value={draft.backupUserId}>Saved manager unavailable</option>}{data.managers.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><p className="text-xs text-muted-foreground">Requires current organization settings and CRM read/write access.{data.managersTruncated ? ' Showing the first 200 eligible managers.' : ''}{data.policy.enabled && !data.managerAvailable ? ' The saved manager is unavailable; choose another manager or pause the policy.' : ''}</p>
      <p className="text-xs text-muted-foreground">Handoff time starts when a visitor confirms the request. First contact time starts at CRM handoff and does not reset on reassignment. Reached or No answer satisfies the contact target; Retry and task completion alone do not. Uses the saved weekly schedule, without holiday overrides or overnight hours.</p>
      {draft.enabled && <label className="flex min-h-11 items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />I approve applying these targets and the current saved hours to all waiting callbacks, including in-app escalation to the selected manager.</label>}
      <Button className="min-h-11" type="submit" disabled={busy || (!dirty && !(draft.enabled && data.hoursChanged)) || draft.enabled && (!acknowledged || !draft.backupUserId || !data.business.hours)}>Save response targets</Button>
    </fieldset></form> : busy ? <p role="status" className="text-sm">Loading response settings…</p> : null}
    <Button className="min-h-11" variant="outline" disabled={busy} onClick={() => { if (dirty) setNavigation('reload'); else void load() }}>Reload target settings</Button>
    <ConfirmDialog open={navigation !== null} onClose={() => setNavigation(null)} title="Discard unsaved target settings?" description="Your local policy edits will be discarded to continue." cancelLabel="Keep editing" confirmLabel="Discard unsaved edits" onConfirm={async () => { const target = navigation; setNavigation(null); if (target === 'reload') await load(); else if (target) { if (data) setDraft(draftOf(data)); router.push(target) } }} />
  </section>
}
