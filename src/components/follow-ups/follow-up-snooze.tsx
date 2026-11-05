'use client'
import { useEffect, useId, useRef, useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { snoozeMetadata, tomorrowLocal } from '@/lib/follow-up-snooze'
import { followUpHeaders, type FollowUpContext } from '@/lib/follow-up-access'
import { followUpData, followUpAccessLost } from '@/lib/follow-up-client'
const receipt = z.object({ id: z.string(), snoozeVersion: z.string().regex(/^[a-f0-9]{64}$/), snooze: snoozeMetadata.nullable() })
type Item = { id: string; snoozeVersion?: string; snooze?: z.infer<typeof snoozeMetadata> | null }
export function FollowUpSnoozeControls({ item, context, disabled, compose, onDiscard, onChanged, onAccessLost, onBusyChange }: { item: Item; context: FollowUpContext; disabled: boolean; compose: boolean; onDiscard: () => void; onChanged: (item: z.infer<typeof receipt>) => void; onAccessLost: (cause: unknown, id: string) => void; onBusyChange?: (busy: boolean) => void }) {
  const [localTime, setLocalTime] = useState(''), [zone, setZone] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [uncertain, setUncertain] = useState(false)
  const [confirmation, setConfirmation] = useState<{ action: 'snooze' | 'wake'; localTime?: string } | null>(null)
  const descriptionId = useId()
  const live = useRef(true), writing = useRef(false), generation = useRef(0)
  useEffect(() => { const requestGeneration = generation; live.current = true; setZone(Intl.DateTimeFormat().resolvedOptions().timeZone); return () => { live.current = false; requestGeneration.current++; onBusyChange?.(false) } }, [onBusyChange])
  useEffect(() => { generation.current++; setConfirmation(null) }, [item.snoozeVersion, disabled])
  const blocked = disabled || busy || uncertain || !item.snoozeVersion || !zone
  async function save(values: { action: 'snooze' | 'wake'; localTime?: string }, discard = false) {
    if (blocked || writing.current) return
    if (compose && !discard) { setConfirmation(values); return }
    if (discard) onDiscard()
    setConfirmation(null); writing.current = true; setBusy(true); onBusyChange?.(true); setError(''); const current = ++generation.current
    try {
      const response = await fetch(`/api/follow-ups/${item.id}/snooze`, { method: 'POST', headers: { ...followUpHeaders(context), 'Content-Type': 'application/json' }, body: JSON.stringify({ action: values.action, expectedVersion: item.snoozeVersion, ...(values.action === 'snooze' ? { localTime: values.localTime, timeZone: zone } : {}) }) })
      const result = receipt.parse((await followUpData(response, context)).data)
      if (result.id !== item.id || !result.snooze || (values.action === 'snooze' ? result.snooze.until === null : result.snooze.until !== null)) throw new Error('Unexpected snooze receipt.')
      if (live.current && current === generation.current) onChanged(result)
    } catch (cause) {
      if (!live.current || current !== generation.current) return
      if (followUpAccessLost(cause)) { onAccessLost(cause, item.id); return }
      setUncertain(true); setError(`${cause instanceof Error ? cause.message : 'Snooze could not be confirmed.'} Refresh the inbox before trying again.`)
    } finally { writing.current = false; if (live.current) { setBusy(false); onBusyChange?.(false) } }
  }
  return <section aria-label="Snooze follow-up" className="mt-4 space-y-3 rounded-lg border p-3">
    <p className="text-xs text-muted-foreground">Snooze this review for yourself. Task due dates and callback deadlines stay the same. Due items return to Pending with an in-app reminder when you refresh or reopen Flowrish.</p>
    {item.snooze?.until && <p className="text-sm">Reminder: <time dateTime={item.snooze.until}>{new Date(item.snooze.until).toLocaleString()}</time> ({item.snooze.timeZone})</p>}
    <div className="flex flex-wrap items-end gap-2"><Button variant="outline" disabled={blocked} onClick={() => void save({ action: 'snooze', localTime: tomorrowLocal() })}>Snooze until tomorrow</Button>{item.snooze?.until && <Button variant="outline" disabled={blocked} onClick={() => void save({ action: 'wake' })}>Wake now</Button>}</div>
    <div className="flex flex-wrap items-end gap-2"><label className="grid gap-1 text-sm">Snooze until<input aria-label="Snooze until" aria-describedby={descriptionId} type="datetime-local" className="min-h-11 max-w-full rounded-md border bg-background px-3 py-2" value={localTime} onChange={event => setLocalTime(event.target.value)} disabled={blocked} /><span id={descriptionId} className="text-xs text-muted-foreground">{zone || 'Detecting timezone…'} · tomorrow means 9:00 AM</span></label><Button variant="outline" disabled={blocked || !localTime} onClick={() => void save({ action: 'snooze', localTime })}>Set snooze</Button></div>
    {confirmation && <div role="group" aria-label="Snooze draft confirmation"><p className="text-sm">Snoozing closes this draft and discards its unsent edits.</p><div className="mt-2 flex flex-wrap gap-2"><Button disabled={blocked} onClick={() => void save(confirmation, true)}>Discard draft and snooze</Button><Button variant="outline" onClick={() => setConfirmation(null)}>Keep editing</Button></div></div>}
    {busy && <p role="status" className="text-sm">Saving snooze…</p>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>
}
