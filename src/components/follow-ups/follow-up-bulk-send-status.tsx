'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { followUpHeaders, type FollowUpContext } from '@/lib/follow-up-access'
import { followUpData, followUpAccessLost, FollowUpClientError } from '@/lib/follow-up-client'
import { emailSendResult } from '@/lib/email-send-result'
import type { SendStatusMetadata } from '@/lib/follow-up-send-status'
import { SendStatusFreshness } from './send-status-freshness'
import { WORKSPACE_EVENT } from '@/lib/workspace-context'

export const BULK_SEND_STATUS_LIMIT = 20
export type SendCheckItem = { id: string; sourceType: string; lead: { firstName: string; lastName: string }; sendStatus?: SendStatusMetadata }
export const canCheckSendStatus = (item: SendCheckItem) => item.sourceType === 'EMAIL' && item.sendStatus !== undefined

type Target = { id: string; name: string }
type Snapshot = { metadata: SendStatusMetadata; checkedAt: number }
type Result = { id: string; state: 'not-checked' | 'checking' | 'unavailable'; previous?: Snapshot } | ({ id: string; state: 'ready' } & Snapshot)
type Props = {
  items: SendCheckItem[]; selectedIds: string[]; context: FollowUpContext; disabled: boolean; otherBusy: boolean
  onSelectionChange: (ids: string[]) => void; onHold: (ids: string[]) => void
  onChecked: (id: string, metadata: SendStatusMetadata) => void; onBusyChange: (busy: boolean) => void
  onAccessLost: (cause?: unknown) => void; onFinished: () => void
}
function resultLabel(row: Result) {
  if (row.state === 'ready') return row.metadata.state === 'CONFIRMED' ? 'Provider accepted' : row.metadata.state === 'UNKNOWN' ? 'Still needs checking' : row.metadata.state === 'FAILED' ? 'Send did not start' : 'No saved send'
  return { 'not-checked': 'Not checked', checking: 'Checking…', unavailable: 'Unavailable' }[row.state]
}

async function readStatus(id: string, context: FollowUpContext, signal: AbortSignal): Promise<SendStatusMetadata> {
  let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined
  const interrupted = new Promise<never>((_, reject) => {
    abort = () => reject(new Error('Status check interrupted.'))
    signal.addEventListener('abort', abort, { once: true })
    timer = setTimeout(() => reject(new Error('Status check timed out.')), 15_000)
  })
  try {
    return await Promise.race([interrupted, (async () => {
      const response = await fetch(`/api/follow-ups/${encodeURIComponent(id)}/send-result`, { method: 'GET', cache: 'no-store', headers: followUpHeaders(context), signal })
      if ([401, 403, 404].includes(response.status)) throw new FollowUpClientError('Send access changed.', response.status, 'FOLLOW_UP_CONTEXT_CHANGED')
      const value = await followUpData<unknown>(response, context)
      if (value.canWrite !== true) throw new FollowUpClientError('Send access changed.', 409, 'FOLLOW_UP_CONTEXT_CHANGED')
      const data = emailSendResult.parse(value.data)
      if (data.id !== id) throw new FollowUpClientError('The requested follow-up changed.', 409, 'FOLLOW_UP_CONTEXT_CHANGED')
      return { state: data.state, updatedAt: data.updatedAt }
    })()])
  } finally { clearTimeout(timer); if (abort) signal.removeEventListener('abort', abort) }
}

export function FollowUpBulkSendStatus(props: Props) {
  const latest = useRef(props); latest.current = props
  const identity = useRef(props.context)
  const contextChanged = identity.current.organizationId !== props.context.organizationId || identity.current.userId !== props.context.userId
  const [phase, setPhase] = useState<'select' | 'review' | 'running' | 'results' | 'revoked'>('select')
  const [targets, setTargets] = useState<Target[]>([]), [results, setResults] = useState<Result[]>([])
  const [remainingReview, setRemainingReview] = useState(false)
  const [offline, setOffline] = useState(false), [notice, setNotice] = useState('')
  const alive = useRef(true), sequence = useRef(0), running = useRef(false), request = useRef<AbortController | null>(null)

  function stop() {
    sequence.current++; request.current?.abort(); request.current = null
    if (!running.current) return
    running.current = false; setPhase('results')
    setResults(rows => rows.map(row => row.state === 'checking' ? { ...row, state: 'not-checked' } : row))
    setNotice('Checks stopped. Review again to continue.'); latest.current.onBusyChange(false); latest.current.onFinished()
  }
  function revoke(cause?: unknown) {
    sequence.current++; request.current?.abort(); request.current = null; running.current = false
    setTargets([]); setResults([]); setPhase('revoked'); latest.current.onSelectionChange([]); latest.current.onHold([])
    latest.current.onBusyChange(false); latest.current.onAccessLost(cause)
  }
  useEffect(() => {
    alive.current = true; setOffline(!navigator.onLine)
    const disconnected = () => { setOffline(true); stop() }
    const connected = () => setOffline(false)
    const changed = () => revoke(new FollowUpClientError('The account or business changed.', 409, 'FOLLOW_UP_CONTEXT_CHANGED'))
    window.addEventListener('offline', disconnected); window.addEventListener('online', connected); window.addEventListener(WORKSPACE_EVENT, changed)
    return () => { alive.current = false; request.current?.abort(); window.removeEventListener('offline', disconnected); window.removeEventListener('online', connected); window.removeEventListener(WORKSPACE_EVENT, changed) }
    // These handlers read current callbacks from latest; reconnect never starts work.
  }, [])
  useEffect(() => { if (props.disabled || contextChanged) revoke(new FollowUpClientError('Send access changed.', 409, 'FOLLOW_UP_CONTEXT_CHANGED')) }, [props.disabled, contextChanged])
  useEffect(() => {
    if (phase !== 'select' && phase !== 'revoked' && targets.some(target => !props.items.some(item => item.id === target.id && canCheckSendStatus(item)))) revoke(new FollowUpClientError('A reviewed follow-up is no longer available.', 409, 'FOLLOW_UP_CONTEXT_CHANGED'))
    // Missing retained rows mean access could not be verified, not an empty selection.
  }, [props.items, targets, phase])

  const eligible = props.items.filter(canCheckSendStatus)
  const selected = props.selectedIds.map(id => eligible.find(row => row.id === id))
  const valid = selected.length > 0 && selected.length <= BULK_SEND_STATUS_LIMIT && selected.every(Boolean) && new Set(props.selectedIds).size === selected.length
  const remaining = targets.filter(target => !results.some(row => row.id === target.id && row.state === 'ready'))
  const completed = targets.length - remaining.length
  const reviewTargets = remainingReview ? remaining : targets
  function review() {
    if (!valid || running.current || latest.current.disabled || latest.current.otherBusy || !navigator.onLine) return
    const reviewed = selected.map(row => ({ id: row!.id, name: `${row!.lead.firstName} ${row!.lead.lastName}`.trim() }))
    setTargets(reviewed); setResults([]); setRemainingReview(false); setNotice(''); setPhase('review'); props.onHold(reviewed.map(row => row.id))
  }
  function clear() {
    if (running.current) return
    setTargets([]); setResults([]); setRemainingReview(false); setNotice(''); setPhase('select'); props.onHold([])
  }
  async function check() {
    if (running.current || phase !== 'review' || props.disabled || props.otherBusy || !navigator.onLine || !reviewTargets.length) return
    const current = ++sequence.current, context = { ...props.context }, reviewed = [...reviewTargets]
    const active = () => alive.current && sequence.current === current && !latest.current.disabled && latest.current.context.organizationId === context.organizationId && latest.current.context.userId === context.userId
    running.current = true; setPhase('running'); setNotice(''); setResults(currentResults => targets.map(target => {
      const previous = currentResults.find(row => row.id === target.id)
      return remainingReview && previous?.state === 'ready' ? previous : { id: target.id, state: 'not-checked', previous: previous?.state === 'ready' ? previous : previous?.previous }
    })); props.onBusyChange(true)
    try {
      for (const target of reviewed) {
        if (!active()) return
        if (!navigator.onLine) { stop(); return }
        const controller = new AbortController(); request.current = controller
        setResults(rows => rows.map(row => row.id === target.id ? { id: row.id, state: 'checking', previous: row.state === 'ready' ? row : row.previous } : row))
        try {
          const metadata = await readStatus(target.id, context, controller.signal)
          if (!active()) return
          setResults(rows => rows.map(row => {
            if (row.id !== target.id) return row
            const previous = row.state === 'ready' ? row : row.previous
            return { id: row.id, state: 'ready', ...(previous?.metadata.state === 'CONFIRMED' && metadata.state !== 'CONFIRMED' ? previous : { metadata, checkedAt: Date.now() }) }
          }))
          latest.current.onChecked(target.id, metadata)
        } catch (cause) {
          if (!active()) return
          if (followUpAccessLost(cause)) { revoke(cause); return }
          setResults(rows => rows.map(row => row.id === target.id ? { id: row.id, state: 'unavailable', previous: row.state === 'ready' ? row : row.previous } : row))
          setNotice('A status could not be verified. Remaining items were not checked.'); break
        } finally { controller.abort(); if (request.current === controller) request.current = null }
      }
    } finally {
      if (active()) { running.current = false; setPhase('results'); latest.current.onBusyChange(false); latest.current.onFinished() }
    }
  }

  if (phase === 'revoked' || props.disabled || contextChanged) return <section aria-label="Check selected send statuses" className="rounded-lg border p-4"><p role="alert">Access changed. Reload before checking send statuses.</p></section>
  return <section aria-label="Check selected send statuses" className="min-w-0 space-y-3 rounded-lg border bg-card p-4">
    <h2 className="text-sm font-semibold">Check selected send statuses</h2>
    <p className="text-xs text-muted-foreground">Select up to 20 email follow-ups. These checks never send email or clear your draft.</p>
    {offline && <p role="status">Offline. Connect and review again to check statuses.</p>}
    {phase === 'select' && <><div className="max-h-64 space-y-1 overflow-y-auto">{eligible.map(item => <label key={item.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={props.selectedIds.includes(item.id)} disabled={props.disabled || props.otherBusy || !props.selectedIds.includes(item.id) && props.selectedIds.length >= BULK_SEND_STATUS_LIMIT} onChange={event => props.onSelectionChange(event.target.checked ? [...props.selectedIds, item.id] : props.selectedIds.filter(id => id !== item.id))} />Check {`${item.lead.firstName} ${item.lead.lastName}`.trim()}</label>)}</div><Button type="button" disabled={!valid || props.disabled || props.otherBusy || offline} onClick={review}>Review selected checks</Button></>}
    {phase === 'review' && <div role="group" aria-label={remainingReview ? 'Remaining send status review' : 'Send status review'} className="space-y-3"><p>Review {reviewTargets.length} {remainingReview ? 'remaining status' : 'status'} {reviewTargets.length === 1 ? 'check' : 'checks'}. No email will be sent.</p><ul className="space-y-1 text-sm">{reviewTargets.map(row => <li key={row.id}>{row.name}</li>)}</ul><div className="flex flex-wrap gap-3"><Button type="button" disabled={props.disabled || props.otherBusy || offline} onClick={() => void check()}>{remainingReview ? 'Check remaining statuses' : 'Check reviewed statuses'}</Button><Button type="button" variant="outline" onClick={() => { if (results.length) { setRemainingReview(false); setPhase('results') } else clear() }}>{remainingReview ? 'Cancel remaining review' : 'Cancel review'}</Button></div></div>}
    {results.length > 0 && <div className="space-y-3"><p role="status" className="text-sm">{completed} of {targets.length} checks completed · {remaining.length} remaining.</p><ul aria-label="Send status results" className="space-y-2 text-sm">{targets.map(target => {
      const row = results.find(result => result.id === target.id) ?? { id: target.id, state: 'not-checked' as const }
      const snapshot = row.state === 'ready' ? row : row.previous
      return <li key={target.id} className="space-y-1"><div className="flex flex-wrap justify-between gap-2"><span>{target.name}</span><span role="status">{snapshot ? resultLabel({ id: target.id, state: 'ready', metadata: snapshot.metadata, checkedAt: snapshot.checkedAt }) : resultLabel(row)}</span></div>{snapshot&&<SendStatusFreshness checkedAt={snapshot.checkedAt}/>}{row.state!=='ready'&&row.previous&&<p className="text-xs text-muted-foreground">{row.state==='checking'?'Rechecking · previous result kept.':row.state==='unavailable'?'Recheck unavailable · previous result kept.':'Recheck not completed · previous result kept.'}</p>}</li>
    })}</ul>{notice && <p role="status" className="text-sm">{notice}</p>}{phase === 'running' && <Button type="button" variant="outline" onClick={stop}>Stop checks</Button>}{phase === 'results' && <div className="flex flex-wrap gap-3">{remaining.length > 0 && <Button type="button" disabled={props.disabled || props.otherBusy || offline} onClick={() => { setRemainingReview(true); setPhase('review'); setNotice('') }}>Review remaining status checks</Button>}<Button type="button" variant="outline" disabled={props.disabled || props.otherBusy || offline} onClick={() => { setRemainingReview(false); setPhase('review'); setNotice('') }}>Review checks again</Button><Button type="button" variant="outline" onClick={clear}>Clear check results</Button></div>}</div>}
  </section>
}
