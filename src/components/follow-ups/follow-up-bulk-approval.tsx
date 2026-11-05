'use client'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { approvalInput, type ApprovalReceipt, type ApprovalInput } from '@/lib/follow-up-approval'
import { BULK_APPROVAL_LIMIT, makeBulkApprovalPlan, previewBulkApproval, runBulkApproval, verifyBulkApproval, type BulkApprovalPlan, type BulkApprovalOutcome } from '@/lib/follow-up-bulk-approval'
import type { FollowUpContext } from '@/lib/follow-up-access'
import { EMAIL_NOTIFICATION_EVENT } from '@/lib/email-notifications'
type Item = { id: string; status: string; sourceType: 'EMAIL' | 'CALL'; taskId: string | null; title: string; snoozeVersion?: string; lead: { firstName: string; lastName: string } }
export const canBulkApprove = (row: Item) => row.status === 'PENDING' && Boolean(row.snoozeVersion && /^[a-f0-9]{64}$/.test(row.snoozeVersion)) && (row.sourceType !== 'CALL' || Boolean(row.taskId))
type Props = { items: Item[]; selectedIds: string[]; blockedIds: string[]; context: FollowUpContext; disabled: boolean; otherBusy: boolean; refreshing: boolean; onSelectionChange: (ids: string[]) => void; onChanged: (receipt: Extract<ApprovalReceipt, { state: 'confirmed' }>) => void; onAccessLost: (cause: unknown, id: string) => void; onBusyChange: (busy: boolean) => void; onRetainReview?: (ids: string[], locked: boolean) => void }
type Draft = BulkApprovalPlan[number] & { existing: boolean; leadName: string }
export function FollowUpBulkApproval(props: Props) {
 const [drafts, setDrafts] = useState<Draft[]>([]), [plan, setPlan] = useState<BulkApprovalPlan | null>(null), [results, setResults] = useState<BulkApprovalOutcome[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('')
 const latest = useRef(props), live = useRef(true), writing = useRef(false), generation = useRef(0), controller = useRef<AbortController | null>(null)
 latest.current = props
 const selectionKey = JSON.stringify(props.selectedIds), byId = new Map(props.items.map(row => [row.id, row])), blocked = new Set(props.blockedIds)
 useEffect(() => { const life = live, counter = generation, pending = controller, current = latest; life.current = true; return () => { life.current = false; counter.current++; pending.current?.abort(); current.current.onBusyChange(false); current.current.onRetainReview?.([], false) } }, [])
 useEffect(() => { if (!writing.current) { setDrafts([]); setPlan(null); setResults([]); setError(''); latest.current.onRetainReview?.([], false) } }, [selectionKey])
 const selectedDirty = props.selectedIds.some(id => blocked.has(id))
 const stale = drafts.some(row => { const item = byId.get(row.id); return !item || !canBulkApprove(item) || blocked.has(row.id) || item.snoozeVersion !== row.listVersion })
 const disabled = props.disabled || props.otherBusy || props.refreshing || busy
 async function execute(kind: 'preview' | 'confirm' | 'check') {
  if (props.disabled || props.otherBusy || props.refreshing || writing.current || kind !== 'check' && (selectedDirty || kind === 'confirm' && stale)) return
  writing.current = true; setBusy(true); props.onBusyChange(true); setError('')
  const current = ++generation.current, request = new AbortController(), scope = JSON.stringify([props.context.organizationId, props.context.userId]); controller.current = request
  const active = () => live.current && generation.current === current && !request.signal.aborted && !latest.current.disabled && JSON.stringify([latest.current.context.organizationId, latest.current.context.userId]) === scope
  const hooks = { active, signal: request.signal, onChanged: (receipt: Extract<ApprovalReceipt, { state: 'confirmed' }>) => { if (active()) latest.current.onChanged(receipt) }, onAccessLost: (cause: unknown, id: string) => { if (active()) latest.current.onAccessLost(cause, id) }, onProgress: (rows: BulkApprovalOutcome[]) => { if (active()) setResults(rows) }, isCurrent: (row: BulkApprovalPlan[number]) => { const item = latest.current.items.find(value => value.id === row.id); return latest.current.selectedIds.includes(row.id) && !latest.current.blockedIds.includes(row.id) && Boolean(item && canBulkApprove(item) && item.snoozeVersion === row.listVersion) } }
  try {
   if (kind === 'preview') {
    if (!props.selectedIds.length || props.selectedIds.some(id => { const row = byId.get(id); return !row || !canBulkApprove(row) })) throw new Error('Select available pending follow-ups before reviewing.')
    setDrafts([]); setPlan(null); setResults([])
    const snapshots = await previewBulkApproval(props.selectedIds, props.context, hooks)
    if (!active()) return
    latest.current.onRetainReview?.(props.selectedIds, false)
    setDrafts(snapshots.map(row => ({ id: row.id, listVersion: byId.get(row.id)?.snoozeVersion, existing: Boolean(row.existingTask), leadName: row.leadName, input: { requestId: crypto.randomUUID(), expectedVersion: row.version, assigneeId: row.assigneeId, title: row.existingTask?.title ?? row.title, description: row.existingTask?.description ?? row.description, dueDate: row.existingTask?.dueDate ?? `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z` } })))
   } else {
    const frozen = kind === 'check' ? plan : makeBulkApprovalPlan(drafts.map(({ id, listVersion, input }) => ({ id, listVersion, input })), props.context)
    if (!frozen) return
    if (kind === 'confirm') { latest.current.onRetainReview?.(frozen.map(row => row.id), true); setPlan(frozen); setResults(frozen.map(row => ({ id: row.id, state: 'not-attempted', message: 'Not attempted.' }))) }
    const next = kind === 'check' ? await verifyBulkApproval(frozen, results, props.context, hooks) : await runBulkApproval(frozen, props.context, hooks)
    if (active()) { setResults(next); window.dispatchEvent(new Event(EMAIL_NOTIFICATION_EVENT)) }
   }
  } catch (cause) { if (active()) setError(cause instanceof Error ? cause.message : 'This approval review could not be confirmed. Refresh and review again.') }
  finally { if (live.current && generation.current === current) { writing.current = false; controller.current = null; setBusy(false); latest.current.onBusyChange(false) } }
 }
 function edit(id: string, changes: Partial<ApprovalInput>) { if (disabled || results.length) return; setDrafts(rows => rows.map(row => row.id === id && !row.existing ? { ...row, input: { ...row.input, ...changes } } : row)) }
 const confirmed = results.filter(row => ['approved', 'verified'].includes(row.state)).length, checking = results.some(row => ['unconfirmed', 'failed'].includes(row.state))
 return <section aria-label="Bulk task approval" aria-busy={busy} className="space-y-3 rounded-lg border bg-card p-4">
  <h2 className="text-sm font-medium">Bulk task approval</h2><p className="text-sm">{props.selectedIds.length} selected · up to {BULK_APPROVAL_LIMIT} loaded follow-ups</p>
  <p className="text-xs text-muted-foreground">Selection is shared with bulk snooze. Review tasks assigned to you. Existing callback tasks keep their details and deadlines. Approving tasks never sends email. Your filters and open email drafts stay available.</p>
  <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={disabled || results.length > 0} onClick={() => props.onSelectionChange(props.items.filter(row => canBulkApprove(row) && !blocked.has(row.id)).slice(0, BULK_APPROVAL_LIMIT).map(row => row.id))}>Select up to 20 for approval</Button><Button type="button" variant="outline" disabled={disabled || !props.selectedIds.length} onClick={() => props.onSelectionChange([])}>Clear approval selection</Button><Button type="button" disabled={disabled || selectedDirty || !props.selectedIds.length || results.length > 0} onClick={() => void execute('preview')}>Review task approvals</Button></div>
  {selectedDirty && <p className="text-sm">Resolve card edits before including those follow-ups in bulk approval. Your edits are kept.</p>}
  {busy && <p role="status" className="text-sm">{plan ? 'Checking or confirming task approvals…' : 'Loading task review…'}</p>}
  {drafts.length > 0 && results.length === 0 && <div role="group" aria-label="Task approval review" className="space-y-3"><p className="text-sm">Confirm each task below. New task dates use UTC. Processing stops on the first failure.</p>{drafts.map(row => <fieldset key={row.id} className="min-w-0 space-y-2 rounded-md border p-3"><legend className="break-words px-1 text-sm font-medium">{byId.has(row.id) ? row.leadName : 'Unavailable follow-up'}</legend><p className="text-xs">Assigned to you</p>{row.existing ? <div className="break-words text-sm"><p>{row.input.title}</p><p className="whitespace-pre-wrap">{row.input.description}</p><p>Existing task due: {new Date(row.input.dueDate).toLocaleString(undefined, { timeZone: 'UTC' })} UTC. Details are kept.</p></div> : <><label className="grid gap-1 text-sm">Task title<input aria-label={`Approval task title for ${row.leadName}`} className="min-h-11 w-full rounded-md border bg-background p-2" maxLength={200} disabled={disabled} value={row.input.title} onChange={event => edit(row.id, { title: event.target.value })} /></label><label className="grid gap-1 text-sm">Task description<textarea aria-label={`Approval task description for ${row.leadName}`} className="w-full rounded-md border bg-background p-2" rows={2} maxLength={10000} disabled={disabled} value={row.input.description} onChange={event => edit(row.id, { description: event.target.value })} /></label><label className="grid gap-1 text-sm">Due date · UTC<input type="date" aria-label={`Approval due date for ${row.leadName}`} className="min-h-11 max-w-full rounded-md border bg-background p-2" disabled={disabled} value={row.input.dueDate.slice(0, 10)} onChange={event => edit(row.id, { dueDate: event.target.value ? `${event.target.value}T00:00:00.000Z` : '' })} /></label></>}</fieldset>)}{stale && <p role="alert" className="text-sm text-destructive">Selected follow-ups changed. Review again before approving.</p>}<Button type="button" disabled={disabled || stale || drafts.some(row => !approvalInput.safeParse(row.input).success)} onClick={() => void execute('confirm')}>Confirm bulk approval</Button></div>}
  {results.length > 0 && <div className="space-y-2"><p role="status" className="text-sm">{confirmed} of {results.length} task approvals confirmed or verified.</p><ul className="space-y-1 text-sm">{results.map(row => { const item = byId.get(row.id); return <li key={row.id} className="break-words">{item ? `${item.lead.firstName} ${item.lead.lastName}: ${item.title}` : 'Unavailable follow-up'} — {row.message}</li> })}</ul>{checking && <><p className="text-xs text-muted-foreground">Check results only reads the exact reviewed request; it does not repeat approval. Clear the selection and review remaining pending items before another attempt.</p><Button type="button" variant="outline" disabled={disabled} onClick={() => void execute('check')}>Check approval results</Button></>}</div>}
  {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
 </section>
}
