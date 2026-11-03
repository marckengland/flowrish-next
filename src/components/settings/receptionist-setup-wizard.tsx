'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { KnowledgeLibrary } from '@/components/knowledge/knowledge-library'
import { WebsiteReceptionistSettings } from './website-receptionist-settings'
import { ReceptionistSetupSimulation } from './receptionist-setup-simulation'
import { SETUP_HISTORY_EVENT } from '@/lib/receptionist-setup-history'
import { businessHoursTemplate, setupBusinessSchema, setupSnapshotSchema, type SetupBusiness, type SetupSnapshot } from '@/lib/receptionist-setup'

import { ReceptionistInstallationCheck } from './receptionist-installation-check'
type Navigation = number | 'reload' | { href: string }
const steps = ['Business', 'Library', 'Website & budget', 'Simulation', 'Review & enable']
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const field = 'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
function resume(data: SetupSnapshot): number { return data.website.settings?.enabled ? 4 : !data.business.saved ? 0 : !data.knowledge.approved ? 1 : !data.readyToEnable ? 2 : 3 }
async function readSnapshot(response: Response): Promise<SetupSnapshot> {
  if (!response.ok) throw new Error(response.status === 403 ? 'Organization administrator access is required.' : response.status === 409 ? 'The saved setup changed. Reload the saved setup and repeat the simulation before enabling. Your local edits have been kept.' : 'Unable to update setup. Reload the saved setup before trying again.')
  return setupSnapshotSchema.parse((await response.json()).data)
}

export function ReceptionistSetupWizard(): React.JSX.Element {
  const router = useRouter()
  const [editorKey, setEditorKey] = useState(0)
  const [snapshot, setSnapshot] = useState<SetupSnapshot | null>(null)
  const [draft, setDraft] = useState<SetupBusiness | null>(null)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [childBusy, setChildBusy] = useState(false)
  const [childDirty, setChildDirty] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [simulation, setSimulation] = useState<string | null>(null)
  const [simulationAcknowledged, setSimulationAcknowledged] = useState(false)
  const [spendingAcknowledged, setSpendingAcknowledged] = useState(false)
  const [navigation, setNavigation] = useState<Navigation | null>(null)
  const current = useRef<SetupSnapshot | null>(null)
  const locked = useRef(false)
  const active = useRef(true)
  const dirty = step === 0 ? !!draft && JSON.stringify(draft) !== JSON.stringify(snapshot?.business.values) : childDirty

  const apply = useCallback((next: SetupSnapshot, resetDraft = false) => {
    if (!active.current) return
    if (current.current?.version !== next.version) { setSimulation(null); setSimulationAcknowledged(false); setSpendingAcknowledged(false) }
    const first = !current.current
    current.current = next; setSnapshot(next)
    if (first || resetDraft) setDraft(next.business.values)
    if (resetDraft) { setEditorKey(value => value + 1); setChildDirty(false); setChildBusy(false) }
    if (first) setStep(new URLSearchParams(window.location.search).get('step') === 'installation' ? (next.website.settings?.allowedOrigins.length ? 3 : 2) : resume(next))
  }, [])
  const refresh = useCallback(async (resetDraft = false) => {
    if (locked.current) return
    locked.current = true; setBusy(true); setError('')
    try { apply(await readSnapshot(await fetch('/api/admin/receptionist/setup', { cache: 'no-store' })), resetDraft) }
    catch (cause) { if (active.current) setError(cause instanceof Error && !(cause instanceof SyntaxError) && !('issues' in cause) ? cause.message : 'Unable to read saved setup. Try reloading.') }
    finally { locked.current = false; if (active.current) setBusy(false) }
  }, [apply])
  const childSaved = useCallback(() => { void refresh() }, [refresh])
  useEffect(() => { active.current = true; void refresh(); return () => { active.current = false } }, [refresh])
  useEffect(() => {
    if (!dirty && !busy && !childBusy) return
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const guardLink = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(anchor instanceof HTMLAnchorElement) || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || anchor.target === '_blank' || anchor.hasAttribute('download') || anchor.href === window.location.href || anchor.origin !== window.location.origin) return
      event.preventDefault(); event.stopPropagation()
      if (busy || childBusy || locked.current) { setNotice('Wait for the current operation to finish before leaving setup.'); return }
      setNavigation({ href: anchor.pathname + anchor.search + anchor.hash })
    }
    const savedEntry = { state: window.history.state, href: window.location.href }
    const guardHistory = (bridgeEvent: Event) => {
      const event = (bridgeEvent as CustomEvent<PopStateEvent>).detail
      if (!busy && !childBusy && !locked.current && window.confirm('Discard your unsaved receptionist setup edits and leave this page?')) return
      // Capture before Next handles popstate. Restore this entry when leaving was
      // declined; otherwise its client navigation would silently drop the draft.
      event.stopImmediatePropagation()
      window.history.pushState(savedEntry.state, '', savedEntry.href)
      if (busy || childBusy || locked.current) setNotice('Wait for the current operation to finish before leaving setup.')
    }
    window.addEventListener('beforeunload', beforeUnload); document.addEventListener('click', guardLink, true); window.addEventListener(SETUP_HISTORY_EVENT, guardHistory)
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', guardLink, true); window.removeEventListener(SETUP_HISTORY_EVENT, guardHistory) }
  }, [dirty, busy, childBusy])

  function navigate(target: Navigation, discard = false) {
    if (busy || childBusy || locked.current || target === step) return
    if (dirty && !discard) { setNavigation(target); return }
    setNavigation(null); setError(''); setNotice('')
    if (target === 'reload') { void refresh(true); return }
    setChildDirty(false); setChildBusy(false)
    if (typeof target === 'object') { router.push(target.href); return }
    if (snapshot) setDraft(snapshot.business.values)
    setStep(target)
  }
  async function write(kind: 'business' | 'launch') {
    if (locked.current || childBusy || !snapshot) return
    if (kind === 'business' && !setupBusinessSchema.safeParse(draft).success) { setError('Enter a business name, valid time zone, at least one day, and closing time later than opening time.'); return }
    if (kind === 'launch' && (!snapshot.readyToEnable || dirty || simulation !== snapshot.version || !spendingAcknowledged || !simulationAcknowledged)) return
    locked.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const body = kind === 'business' ? { values: draft, expectedUpdatedAt: snapshot.business.updatedAt } : { expectedVersion: snapshot.version, simulationReviewed: true, acknowledged: true }
      const next = await readSnapshot(await fetch(`/api/admin/receptionist/setup/${kind}`, { method: kind === 'business' ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
      apply(next, kind === 'business'); if (active.current) setNotice(kind === 'business' ? 'Business details saved.' : 'Website receptionist enabled.')
    } catch (cause) { if (active.current) setError(cause instanceof Error && !('issues' in cause) ? cause.message : 'Unable to update setup. Reload the saved setup before trying again.') }
    finally { locked.current = false; if (active.current) setBusy(false) }
  }
  const enabled = !!snapshot?.website.settings?.enabled
  const reviewed = !!snapshot && simulation === snapshot.version
  const missing = snapshot ? [!snapshot.business.saved && 'Save business details.', !snapshot.knowledge.approved && 'Publish and approve at least one Library document for public answers.', !snapshot.website.hasOrganizationAi && 'Save and enable an organization AI provider in Settings.', !snapshot.website.settings?.allowedOrigins.length && 'Save at least one exact HTTPS website and its limits.'].filter(Boolean) : []
  return <div className="mx-auto max-w-4xl space-y-6 pb-8">
    <header className="space-y-2"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Website receptionist</p><h1 className="text-2xl font-semibold tracking-tight">Set up your business receptionist</h1><p className="max-w-2xl text-sm text-muted-foreground">Answer questions for visitors to your organization’s website using your approved business information. Phone reception is configured separately.</p><Link className="inline-flex min-h-11 items-center text-sm font-medium underline" href="/receptionist">Receptionist home</Link></header>
    {error && <p role="alert" className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {snapshot && draft ? <>
      <nav aria-label="Guided setup steps" className="grid grid-cols-2 gap-2 sm:grid-cols-5">{steps.map((label, index) => <Button key={label} variant={step === index ? 'default' : 'outline'} className="h-auto min-h-11 whitespace-normal px-3 py-2 text-left text-xs" aria-current={step === index ? 'step' : undefined} disabled={busy || childBusy} onClick={() => navigate(index)}>{index + 1}. {label}</Button>)}</nav>
      <p className="text-xs text-muted-foreground">Step {step + 1} of 5 · Website {enabled ? 'enabled' : 'off'} · {snapshot.knowledge.approved} public-approved documents</p>
      <fieldset disabled={busy} className="min-w-0 space-y-5 rounded-xl border bg-card p-4 sm:p-6">
        {step === 0 && <form className="space-y-4" onSubmit={event => { event.preventDefault(); void write('business') }}>
          <h2 className="text-lg font-semibold">Your business</h2><p className="text-sm text-muted-foreground">Save your business name and local opening hours. To let website visitors ask about hours, add them to the Library and approve the published document in the next step.</p>
          <label className="block text-sm font-medium">Business name<input required maxLength={120} className={field} value={draft.businessName} onChange={event => setDraft({ ...draft, businessName: event.target.value })} /></label>
          <label className="block text-sm font-medium">Time zone<input required maxLength={100} className={field} placeholder="Asia/Manila" value={draft.timeZone} onChange={event => setDraft({ ...draft, timeZone: event.target.value })} /><span className="text-xs font-normal text-muted-foreground">Use an IANA time zone, such as Asia/Manila or America/New_York.</span></label>
          <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-medium">Opening time<input className={field} type="time" required value={draft.opensAt} onChange={event => setDraft({ ...draft, opensAt: event.target.value })} /></label><label className="block text-sm font-medium">Closing time<input className={field} type="time" required value={draft.closesAt} onChange={event => setDraft({ ...draft, closesAt: event.target.value })} /></label></div>
          <fieldset><legend className="mb-2 text-sm font-medium">Business days</legend><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{days.map((day, index) => <label key={day} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={draft.businessDays.includes(index)} onChange={event => setDraft({ ...draft, businessDays: (event.target.checked ? [...draft.businessDays, index] : draft.businessDays.filter(value => value !== index)).sort() })} />{day}</label>)}</div></fieldset>
          {snapshot.business.phoneEnabled && <p className="text-sm">Phone reception is currently enabled. These business details also update its greeting and hours.</p>}
          <Button type="submit" disabled={busy || snapshot.business.saved && !dirty}>Save business details</Button>
        </form>}
        {step === 1 && <div className="space-y-4"><p className="text-sm text-muted-foreground">Add services, pricing, FAQs, and opening hours. Save the draft, publish it, then separately approve the published version for public receptionist answers. Private drafts and phone notes are excluded.</p><KnowledgeLibrary key={editorKey} embedded template={snapshot.business.saved ? businessHoursTemplate(snapshot.business.values) : undefined} onDirtyChange={setChildDirty} onBusyChange={setChildBusy} onChanged={childSaved} /></div>}
        {step === 2 && <div className="space-y-4"><p className="text-sm text-muted-foreground">Choose the websites and daily usage limits before launch. Saving here preserves the website’s current enabled state.</p><p className="text-sm"><a className="underline" href="/settings?section=ai-provider">Manage organization AI provider in Settings</a>. Saving a provider does not run a connection test. Live traffic uses that provider’s credits.</p><WebsiteReceptionistSettings key={editorKey} setupOnly initialData={snapshot.website} onDirtyChange={setChildDirty} onBusyChange={setChildBusy} onSaved={childSaved} /></div>}
        {step === 3 && <><ReceptionistSetupSimulation key={snapshot.version} snapshot={snapshot} completed={reviewed} onComplete={setSimulation} />{snapshot.website.settings && <div className="space-y-2"><h3 className="text-sm font-medium">Install on an allowed website</h3><p className="text-sm text-muted-foreground">Copy this snippet into your website. No widget is loaded in this simulation; visitors can use it after you explicitly enable reception.</p><pre className="overflow-x-auto rounded-md border bg-muted/30 p-3 text-xs"><code>{`<script src="${typeof window === 'undefined' ? '' : window.location.origin}/receptionist-widget.js" data-flowrish-receptionist="${snapshot.website.settings.publicId}" defer></script>`}</code></pre><ReceptionistInstallationCheck key={snapshot.website.settings.updatedAt} settings={snapshot.website.settings} /></div>}</>}
        {step === 4 && <div className="space-y-4"><h2 className="text-lg font-semibold">Review and enable</h2>{enabled ? <p className="font-medium">Your website receptionist is enabled.</p> : <p className="text-sm text-muted-foreground">Enabling allows visitors on the saved websites to start real AI conversations. Installing the snippet alone does not enable it.</p>}
          <dl className="grid gap-3 break-words text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Business</dt><dd>{snapshot.business.values.businessName}</dd></div><div><dt className="text-muted-foreground">Approved Library</dt><dd>{snapshot.knowledge.approved} documents · {snapshot.knowledge.approvedCategories.join(', ') || 'None'}</dd></div><div><dt className="text-muted-foreground">Allowed websites</dt><dd>{snapshot.website.settings?.allowedOrigins.join(', ') || 'Not saved'}</dd></div><div><dt className="text-muted-foreground">Daily website limits</dt><dd>{snapshot.website.settings ? `${snapshot.website.settings.dailyMessageLimit} messages · ${snapshot.website.settings.dailyTokenLimit} reserved tokens · ${snapshot.website.settings.dailyCallbackLimit} callbacks` : 'Not saved'}</dd></div></dl>
          {!!missing.length && <ul className="list-inside list-disc space-y-1 text-sm">{missing.map(item => <li key={String(item)}>{item}</li>)}</ul>}
          {!enabled && <>{!reviewed && <p className="text-sm">Run and confirm a new local simulation for this saved setup before enabling.</p>}<label className="flex min-h-11 items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={simulationAcknowledged} onChange={event => setSimulationAcknowledged(event.target.checked)} />I understand this simulation did not test live AI responses or connectivity.</label><label className="flex min-h-11 items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={spendingAcknowledged} onChange={event => setSpendingAcknowledged(event.target.checked)} />I approve the saved websites, public knowledge, and daily limits. Live visitors may spend organization AI provider credits.</label><Button disabled={!snapshot.readyToEnable || !reviewed || !simulationAcknowledged || !spendingAcknowledged || dirty || busy} onClick={() => { void write('launch') }}>Enable website receptionist</Button></>}
        </div>}
      </fieldset>
      <div className="flex flex-wrap items-center gap-2"><Button variant="outline" disabled={step === 0 || busy || childBusy} onClick={() => navigate(step - 1)}>Previous step</Button><Button disabled={step === 4 || busy || childBusy} onClick={() => navigate(step + 1)}>Next step</Button><Button variant="ghost" disabled={busy || childBusy} onClick={() => navigate('reload')}>Reload saved setup</Button></div>
      {navigation !== null && <div role="alertdialog" aria-modal="true" aria-label="Unsaved setup edits" className="space-y-3 rounded-lg border p-4"><p className="text-sm">You have unsaved edits. Discard them to continue?</p><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setNavigation(null)}>Keep editing</Button><Button onClick={() => navigate(navigation, true)}>Discard unsaved edits</Button></div></div>}
    </> : <Button variant="outline" disabled={busy} onClick={() => { void refresh() }}>{busy ? 'Loading saved setup…' : 'Reload saved setup'}</Button>}
  </div>
}
