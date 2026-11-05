'use client'
import { useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { inputBaseClass } from '@/components/ui/input'
import { MERGE_USER_HEADER, duplicateMatches, mergeResponse, type MergePreview, type MergeResult } from '@/lib/lead-merge'
interface Props { leadId: string; organizationId: string; userId: string; canMerge: boolean }
class MergeError extends Error { constructor(public status: number, public code: string, message: string) { super(message) } }
export function DuplicateCheck(props: Props) { return <ScopedDuplicates key={`${props.organizationId}:${props.userId}:${props.leadId}`} {...props} /> }
function ScopedDuplicates({ leadId, organizationId, userId, canMerge }: Props) {
  const router = useRouter(), cache = useQueryClient(), title = useId(), keeperId = useId(), confirmId = useId(), candidatesId = useId()
  const [matches, setMatches] = useState<ReturnType<typeof duplicateMatches.parse>>([]), [candidate, setCandidate] = useState(''), [keeper, setKeeper] = useState(leadId)
  const [review, setReview] = useState<MergePreview | null>(null), [confirmed, setConfirmed] = useState(false), [uncertain, setUncertain] = useState(false)
  const [busy, setBusy] = useState(false), [checked, setChecked] = useState(false), [denied, setDenied] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const active = useRef(false), writing = useRef(false)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  async function request(path: string, body: unknown) {
    const response = await fetch(path, { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-flowrish-workspace': organizationId, [MERGE_USER_HEADER]: userId }, body: JSON.stringify(body) })
    const value = await response.json()
    if (!response.ok) throw new MergeError(response.status, value?.error?.code ?? '', value?.error?.message ?? 'Merge unavailable.')
    if (value?.scope?.organizationId !== organizationId || value?.scope?.userId !== userId) throw new MergeError(409, 'MERGE_CONTEXT_CHANGED', 'The business or account changed. Reload before continuing.')
    return value.data as unknown
  }
  function fail(reason: unknown) {
    setError(reason instanceof MergeError ? reason.message : 'Could not confirm the request. Retry the same confirmed merge before starting another.')
    if (reason instanceof MergeError && ([401, 403].includes(reason.status) || reason.code === 'MERGE_CONTEXT_CHANGED')) { setDenied(true); setMatches([]); setCandidate(''); setReview(null) }
  }
  function clearReview() { setReview(null); setConfirmed(false); setError(''); setNotice('') }
  function done(result: MergeResult) {
    setReview(null); setMatches([]); setCandidate(''); setUncertain(false); setConfirmed(false); setError(''); setNotice('Merge confirmed. The secondary record is archived and its reviewed data was retained.')
    void Promise.all(['leads', 'activities', 'tasks', 'email-threads', 'audit-log', 'contacts'].map(root => cache.invalidateQueries({ queryKey: [root] }))); router.push(`/leads/${result.primaryId}`); router.refresh()
  }
  async function search() {
    if (writing.current || uncertain || denied) return
    writing.current = true; setBusy(true); setChecked(false); setMatches([]); setCandidate(''); setKeeper(leadId); clearReview()
    try { const rows = duplicateMatches.parse(await request('/api/duplicates/check', { leadId })); if (active.current) { setMatches(rows); setChecked(true) } }
    catch (reason) { if (active.current) fail(reason) }
    finally { writing.current = false; if (active.current) setBusy(false) }
  }
  async function prepare() {
    if (writing.current || uncertain || denied || !canMerge || !candidate) return
    const id = crypto.randomUUID(), primaryId = keeper, secondaryId = keeper === leadId ? candidate : leadId
    writing.current = true; setBusy(true); clearReview()
    try {
      const value = mergeResponse.parse(await request('/api/leads/merge/preview', { id, primaryId, secondaryId }))
      if (!active.current) return
      if (value.id !== id || value.primaryId !== primaryId || value.secondaryId !== secondaryId) throw new Error('Unexpected merge review')
      if (value.state === 'applied') done(value); else setReview(value)
    } catch (reason) { if (active.current) fail(reason) }
    finally { writing.current = false; if (active.current) setBusy(false) }
  }
  async function apply() {
    if (writing.current || denied || !canMerge || !review || review.blockers.length || (!confirmed && !uncertain)) return
    writing.current = true; setBusy(true); setUncertain(true); setError('')
    try {
      const value = mergeResponse.parse(await request('/api/leads/merge/apply', { id: review.id, confirmed: true }))
      if (!active.current) return
      if (value.state !== 'applied' || value.id !== review.id || value.primaryId !== review.primaryId || value.secondaryId !== review.secondaryId) throw new Error('Unexpected merge receipt')
      done(value)
    } catch (reason) {
      if (!active.current) return
      fail(reason)
      if (reason instanceof MergeError && [400, 401, 403, 404, 409, 410, 413].includes(reason.status)) { setUncertain(false); setReview(null); setConfirmed(false) }
    } finally { writing.current = false; if (active.current) setBusy(false) }
  }
  return <section aria-labelledby={title} className="min-w-0 space-y-3">
    <h3 id={title} className="font-medium">Review possible duplicates</h3>
    <p className="text-sm text-muted-foreground">Email and company matches are suggestions. Confirm both records describe the same prospect.</p>
    <Button variant="outline" className="min-h-11" disabled={busy || uncertain || denied} onClick={() => void search()}>Check for duplicates</Button>
    {!canMerge && <p className="text-sm">Merging requires lead read, write, and delete permission.</p>}
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {denied && <Button variant="outline" onClick={() => window.location.reload()}>Reload lead</Button>}
    {checked && !matches.length && <p role="status" className="text-sm">No permitted duplicates found.</p>}
    {matches.length > 0 && <fieldset className="min-w-0 space-y-2" disabled={busy || uncertain || denied}><legend className="text-sm">Choose one possible duplicate</legend>{matches.map(match => <label key={match.leadId} className="flex min-h-11 items-start gap-2 break-words rounded border p-3 text-sm"><input type="radio" className="mt-1 size-5 shrink-0" name={candidatesId} aria-label={`Choose duplicate ${match.leadName}`} checked={candidate === match.leadId} onChange={() => { setCandidate(match.leadId); setKeeper(leadId); clearReview() }} /><span className="min-w-0"><strong>{match.leadName}</strong><span className="block break-all text-xs">{match.matchType}: {match.matchValue}</span></span></label>)}</fieldset>}
    {matches.length === 50 && <p className="text-sm">Showing up to 50 permitted matches.</p>}
    {candidate && canMerge && !denied && <div className="space-y-2"><label htmlFor={keeperId} className="block text-sm">Lead to keep</label><select id={keeperId} className={`${inputBaseClass} min-h-11 w-full`} value={keeper} disabled={busy || uncertain} onChange={event => { setKeeper(event.target.value); clearReview() }}><option value={leadId}>Keep current lead</option><option value={candidate}>Keep {matches.find(row => row.leadId === candidate)?.leadName}</option></select><Button className="min-h-11" disabled={busy || uncertain} onClick={() => void prepare()}>Preview merge</Button></div>}
    {review && !denied && <div className="min-w-0 space-y-3 rounded border p-3">
      <p className="break-words text-sm"><strong>Keep {review.primaryLabel}</strong> ({review.primaryId}). Archive {review.secondaryLabel} ({review.secondaryId}). The retained lead keeps its field values; the original secondary fields remain in its archive. Its email stays in use for future matching and sending; existing conversations are preserved as history.</p>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Side-by-side lead comparison"><table className="w-full min-w-[520px] table-fixed text-left text-sm"><thead><tr><th scope="col" className="w-1/4 p-2">Field</th><th scope="col" className="p-2">Retained value</th><th scope="col" className="p-2">Archived value</th></tr></thead><tbody>{review.fields.map(field => <tr key={field.key} className={field.different ? 'bg-muted/40' : ''}><th scope="row" className="break-words p-2 font-normal capitalize">{field.label}</th><td className="whitespace-pre-wrap break-words p-2">{field.primary}</td><td className="whitespace-pre-wrap break-words p-2">{field.secondary}</td></tr>)}</tbody></table></div>
      <p className="text-sm">Transfer {review.counts.Activity} activities, {review.counts.Task} tasks, {review.counts.StageTransition} stage-history entries, and {review.counts.ScoreHistory} score-history entries. Add {review.counts.LeadContact} missing contact links. Existing archive contact links remain intact.</p>
      <p className="text-xs text-muted-foreground">Review expires {new Date(review.expiresAt).toLocaleString()}. No emails or automated steps are sent by merging.</p>
      {review.blockers.length > 0 && <div role="alert" className="space-y-1 text-sm"><p>This merge is blocked:</p><ul className="list-disc pl-5">{review.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul></div>}
      {uncertain ? <><p className="text-sm">This merge may already be complete. Retry the same confirmed request to retrieve its result.</p><Button className="min-h-11" disabled={busy} onClick={() => void apply()}>Retry confirmed merge</Button></> : <><label htmlFor={confirmId} className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" className="mt-1 size-5 shrink-0" id={confirmId} checked={confirmed} disabled={busy || !!review.blockers.length} onChange={event => setConfirmed(event.target.checked)} />I reviewed the retained fields, transfers, and archived record</label><div className="flex flex-wrap gap-2"><Button className="min-h-11" disabled={busy || !confirmed || !!review.blockers.length} onClick={() => void apply()}>Confirm merge</Button><Button className="min-h-11" variant="outline" disabled={busy} onClick={clearReview}>Cancel review</Button></div></>}
    </div>}
  </section>
}
