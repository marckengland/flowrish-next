'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { SetupSnapshot } from '@/lib/receptionist-setup'
import { websiteCallbackInputSchema } from '@/lib/website-receptionist'

export function ReceptionistSetupSimulation({ snapshot, completed, onComplete }: { snapshot: SetupSnapshot; completed: boolean; onComplete: (version: string | null) => void }): React.JSX.Element {
  const [running, setRunning] = useState(false)
  const [name, setName] = useState('Sample Visitor')
  const [phone, setPhone] = useState('+12025550123')
  const [reason, setReason] = useState('Please call me about your services.')
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState('')
  const edit = () => { setConsent(false); setError(''); onComplete(null) }
  function confirm() {
    const parsed = websiteCallbackInputSchema.safeParse({ fullName: name, phone, reason, confirmed: consent, website: '' })
    if (!parsed.success) { setError('Enter a valid sample name, international phone number, and callback reason.'); return }
    setError(''); onComplete(snapshot.version)
  }
  return <div className="space-y-4">
    <h2 className="text-lg font-semibold">Simulated rehearsal</h2>
    <p className="text-sm text-muted-foreground">This is a local simulation using saved details and an approved Library excerpt. It makes no AI or phone requests, spends no provider credits, and creates no leads, tasks, or callback requests. It does not verify live AI quality or connectivity.</p>
    <Button disabled={!snapshot.readyToEnable} onClick={() => { setRunning(true); edit() }}>{running || completed ? 'Run another local simulation' : 'Run local simulation'}</Button>
    {!snapshot.readyToEnable && <p className="text-sm">Complete the saved business, approved Library, organization AI, and website configuration first.</p>}
    {running && <div className="space-y-4 rounded-lg border p-4">
      <p className="text-sm break-words">Hello, you’ve reached {snapshot.business.values.businessName}. How can we help?</p>
      <div className="space-y-1 text-sm"><p className="font-medium">Approved Library excerpt · simulated answer</p><p className="whitespace-pre-wrap break-words">{snapshot.knowledge.sample?.text ?? 'No short approved excerpt is available. For questions the Library cannot answer, offer a callback.'}</p></div>
      <p className="text-sm">Unknown question: “Can you guarantee a same-day appointment?”</p><p className="text-sm">Simulated fallback: I can’t confirm that from the approved information. Would you like someone from the business to call you?</p>
      <p className="text-xs text-muted-foreground">Use fictional details only. These fields stay in this browser component.</p>
      <label className="block text-sm">Sample name<input className="mt-1 w-full rounded-md border bg-background px-3 py-2" value={name} maxLength={120} onChange={event => { setName(event.target.value); edit() }} /></label>
      <label className="block text-sm">Sample phone<input className="mt-1 w-full rounded-md border bg-background px-3 py-2" type="tel" value={phone} maxLength={30} onChange={event => { setPhone(event.target.value); edit() }} /></label>
      <label className="block text-sm">Sample callback reason<textarea className="mt-1 w-full rounded-md border bg-background px-3 py-2" value={reason} maxLength={1000} onChange={event => { setReason(event.target.value); edit() }} /></label>
      <div aria-label="Simulated callback readback" className="break-words rounded-md bg-muted/40 p-3 text-sm">Sample readback: {name} · {phone} · {reason}</div>
      <label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={consent} onChange={event => { setConsent(event.target.checked); onComplete(null) }} />I reviewed these sample details and consent to this simulated callback.</label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button variant="outline" disabled={!consent || !snapshot.readyToEnable} onClick={confirm}>Confirm simulated callback</Button>
    </div>}
    {completed && <p role="status" className="text-sm font-medium">Simulation reviewed for this saved setup. No callback was submitted.</p>}
  </div>
}
