'use client'
import { FollowUpTaskHistory } from './follow-up-task-history'
import { FollowUpTaskProgress } from './follow-up-task-progress'
import { FollowUpTaskReschedule, type RescheduleHold } from './follow-up-task-reschedule'
import type { TaskRescheduleReceipt } from '@/lib/follow-up-task-reschedule'
import { FollowUpTaskCompletion } from './follow-up-task-completion'
import type { TaskCompletionReceipt } from '@/lib/follow-up-task-completion'
import { filtersForFollowUpTab, type TaskProgress } from '@/lib/follow-up-task-progress'
import { FollowUpBulkApproval, canBulkApprove } from './follow-up-bulk-approval'
import type { ApprovalReceipt } from '@/lib/follow-up-approval'
import { SavedFollowUpViews } from './saved-follow-up-views'
import type { SavedFollowUpSettings } from '@/lib/saved-follow-up-views'
import type { FollowUpPageMeta } from '@/lib/follow-up-page'

import Link from 'next/link'
import { FollowUpBulkSnooze, canBulkSnooze } from './follow-up-bulk-snooze'
import { BULK_SNOOZE_LIMIT, type BulkSnoozeReceipt } from '@/lib/follow-up-bulk-snooze'
import { FollowUpSnoozeControls } from './follow-up-snooze'
import { FollowUpHistory } from './follow-up-history'
import type { SnoozeMetadata } from '@/lib/follow-up-snooze'
import { EMAIL_NOTIFICATION_EVENT, focusedEmailReply } from '@/lib/email-notifications'
import { EmailNotificationError, emailNotificationData, emailNotificationHeaders } from '@/lib/email-notification-client'
import { EmailMatchInbox, type EmailMatchContext } from './email-match-inbox'
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Check, Inbox, Mail, Phone, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmailCompose } from '@/components/email/email-compose'
import { followUpHeaders, type FollowUpContext } from '@/lib/follow-up-access'
import { followUpAccessLost, followUpData, FollowUpClientError } from '@/lib/follow-up-client'
import { readFollowUpPages } from './follow-up-pages'
import { cn } from '@/lib/utils'
import { followUpFilterSchema, hasFollowUpFilters, type FollowUpFilters } from '@/lib/follow-up-filters'

type FollowUpStatus = 'PENDING' | 'APPROVED' | 'DISMISSED'
type FollowUpView = FollowUpStatus | 'SNOOZED'
type Navigation = 'refresh' | FollowUpView | { replyId: string | undefined } | { filters: FollowUpFilters } | { settings: SavedFollowUpSettings }
const emptyFilters = followUpFilterSchema.parse({})

export interface FollowUpItem {
  taskProgress?: TaskProgress
  snoozeVersion?: string
  snooze?: SnoozeMetadata | null
  id: string
  sourceType: 'EMAIL' | 'CALL'
  sourceText: string
  title: string
  description: string
  draftSubject: string | null
  draftBody: string | null
  status: FollowUpStatus
  taskId: string | null
  lead: { id: string; firstName: string; lastName: string; email: string | null }
  createdAt: string
  draftGeneratedAt?: string | null
  draftVersion?: string | null
  draftContext?: DraftContext | null
}

interface DraftContext {
  accountId: string
  provider: 'gmail' | 'microsoft'
  threadId: string
  recipientEmail: string
  mailboxEmail?: string
  messageCount: number
  lastMessageAt: string
}
interface GeneratedDraft {
  id: string
  subject: string
  body: string
  generatedAt: string
  version: string
  context: DraftContext
}

const tabs: { value: FollowUpView; label: string }[] = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'DISMISSED', label: 'Dismissed' },
  { value: 'SNOOZED', label: 'Snoozed' },
]
const fieldClass = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60'

function draftHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\r?\n/g, '<br />')
}

async function responseData<T>(response: Response, context?: FollowUpContext): Promise<T> {
  return (await followUpData<T>(response, context)).data
}

type FollowUpInboxProps = { canWrite: boolean; children?: ReactNode; emailMatchContext?: EmailMatchContext; initialMessageId?: string; initialReplyId?: string }
export function FollowUpInbox(props: FollowUpInboxProps): React.JSX.Element {
  return <ScopedFollowUpInbox key={props.emailMatchContext ? `${props.emailMatchContext.organizationId}:${props.emailMatchContext.userId}` : 'legacy'} {...props} />
}
function ScopedFollowUpInbox({ canWrite, children, emailMatchContext, initialMessageId, initialReplyId }: FollowUpInboxProps): React.JSX.Element {
  const emailOrganizationId = emailMatchContext?.organizationId, emailUserId = emailMatchContext?.userId
  const [writeAllowed, setWriteAllowed] = useState(canWrite)
  const taskProgressDescription = useId()
  const [taskOrderSupported, setTaskOrderSupported] = useState(false)
  const [taskProgressSupported, setTaskProgressSupported] = useState(false)
  const [revoked, setRevoked] = useState(false)
  const revokedRef = useRef(false)
  const [status, setStatus] = useState<FollowUpView>('PENDING')
  const [viewsOpen, setViewsOpen] = useState(false)
  const [filters, setFilters] = useState<FollowUpFilters>(emptyFilters)
  const [filterDraft, setFilterDraft] = useState<FollowUpFilters>(emptyFilters)
  const filterDraftRef = useRef(filterDraft); filterDraftRef.current = filterDraft
  const retainedOrderCommit = useRef<FollowUpFilters | null>(null), retryOrder = useRef<FollowUpFilters | undefined>(undefined)
  const [filterError, setFilterError] = useState('')
  const [items, setItems] = useState<FollowUpItem[]>([])
  const [loading, setLoading] = useState(true)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [pageSupported, setPageSupported] = useState(false)
  const [pageTask, setPageTask] = useState<'more' | 'refresh' | 'catch-up' | null>(null)
  const [pageError, setPageError] = useState('')
  const [bulkSelected, setBulkSelected] = useState<string[]>([])
  const [bulkBusy, setBulkBusy] = useState(false)
  const [approvalOpen, setApprovalOpen] = useState(false), [approvalBusy, setApprovalBusy] = useState(false)
  const [, setEditorRevision] = useState(0)
  const [approvalLocked, setApprovalLocked] = useState(false)
  const approvalLockRef = useRef(false)
  const approvedRetained = useRef(new Set<string>())
  const bulkRetained = useRef(new Set<string>()), bulkBusyRef = useRef(false)
  const [callbackCatchUp, setCallbackCatchUp] = useState<FollowUpPageMeta['callbackCatchUp']>()
  const retryCatchUp = useRef(false)
  const pagesLoaded = useRef(1), retryDepth = useRef(1), pageFailed = useRef(false), loadingRef = useRef(true)
  const pageController = useRef<AbortController | null>(null)
  const pendingRevalidation = useRef(false)
  const abortPages = useCallback(() => { pageController.current?.abort(); pageController.current = null; pendingRevalidation.current = false; retryOrder.current = undefined }, [])
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [navigation, setNavigation] = useState<Navigation | null>(null)
  const [focusedReplyId, setFocusedReplyId] = useState(initialReplyId)
  const [focusedError, setFocusedError] = useState('')
  const [snoozeNotice, setSnoozeNotice] = useState('')
  const hiddenFocused = useRef<string | null>(null)
  const readEpoch = useRef(0)
  const openDrafts = useRef(new Set<string>())
  const rescheduleHolds = useRef(new Map<string, RescheduleHold>()), [rescheduleCount, setRescheduleCount] = useState(0)
  const retainReschedule = useCallback((id: string, hold: RescheduleHold) => {
    const previous = rescheduleHolds.current.get(id) ?? false
    if (hold) rescheduleHolds.current.set(id, hold); else rescheduleHolds.current.delete(id)
    if (previous !== hold) { readEpoch.current++; setRescheduleCount(rescheduleHolds.current.size) }
  }, [])
  const pendingCompletions = useRef(new Set<string>()), [pendingCompletionCount, setPendingCompletionCount] = useState(0)
  const retainCompletion = useCallback((id: string, pending: boolean) => {
    const had = pendingCompletions.current.has(id)
    if (pending) pendingCompletions.current.add(id); else pendingCompletions.current.delete(id)
    if (had !== pending) { readEpoch.current++; setPendingCompletionCount(pendingCompletions.current.size) }
  }, [])
  const dirtyEditors = useRef(new Set<string>())
  const trackEditor = useCallback((id: string, dirty: boolean) => { const had = dirtyEditors.current.has(id); if (dirty) dirtyEditors.current.add(id); else dirtyEditors.current.delete(id); if (had !== dirty) { readEpoch.current++; setEditorRevision(value => value + 1) } }, [])
  const changeBulkSelection = useCallback((ids: string[]) => {
    if (bulkBusyRef.current || ids.length > BULK_SNOOZE_LIMIT || approvalLockRef.current && ids.length > 0) return
    if (!ids.length) { approvalLockRef.current = false; setApprovalLocked(false) }
    approvedRetained.current = new Set([...approvedRetained.current].filter(id => ids.includes(id)))
    const previous = bulkRetained.current
    bulkRetained.current = new Set(ids); readEpoch.current++; setBulkSelected(ids)
    if (!ids.length && previous.size && (status === 'PENDING' || status === 'SNOOZED')) setItems(rows => rows.filter(row => !previous.has(row.id) || openDrafts.current.has(row.id) || dirtyEditors.current.has(row.id) || row.status === 'PENDING' && (status === 'SNOOZED' ? Boolean(row.snooze?.until && new Date(row.snooze.until).getTime() > Date.now()) : !row.snooze?.until || new Date(row.snooze.until).getTime() <= Date.now())))
  }, [status])
  const changeBulkBusy = useCallback((busy: boolean) => { bulkBusyRef.current = busy; setBulkBusy(busy); if (busy) { abortPages(); setPageTask(null); readEpoch.current++ } }, [abortPages])
  const changeApprovalBusy = useCallback((busy: boolean) => { setApprovalBusy(busy); changeBulkBusy(busy) }, [changeBulkBusy])
  const retainApprovalReview = useCallback((ids: string[], locked: boolean) => { approvedRetained.current = new Set(ids); approvalLockRef.current = locked; setApprovalLocked(locked) }, [])
  const bulkApprovalChanged = useCallback((receipt: Extract<ApprovalReceipt, { state: 'confirmed' }>) => {
    readEpoch.current++
    approvedRetained.current.add(receipt.id)
    setItems(rows => rows.map(row => row.id === receipt.id ? { ...row, status: 'APPROVED', taskId: receipt.task.id, title: receipt.task.title, description: receipt.task.description } : row))
  }, [])
  const taskCompleted = useCallback((receipt: Extract<TaskCompletionReceipt, { state: 'confirmed' }>) => {
    readEpoch.current++
    setItems(rows => rows.map(row => row.status === 'APPROVED' && row.taskId === receipt.task.id && row.taskProgress?.state !== 'UNAVAILABLE' ? { ...row, taskProgress: { state: 'COMPLETED', dueDate: receipt.task.dueDate, completedAt: receipt.task.completedAt, checkedAt: receipt.task.checkedAt } } : row))
  }, [])
  const taskRescheduled = useCallback((receipt: Extract<TaskRescheduleReceipt, { state: 'confirmed' }>) => {
    readEpoch.current++
    setItems(rows => rows.map(row => row.status === 'APPROVED' && row.taskId === receipt.task.id && row.taskProgress?.state !== 'UNAVAILABLE' ? { ...row, taskProgress: { state: new Date(receipt.task.dueDate) < new Date(receipt.task.checkedAt) ? 'OVERDUE' : 'OPEN', dueDate: receipt.task.dueDate, completedAt: null, checkedAt: receipt.task.checkedAt } } : row))
  }, [])
  const bulkSnoozeChanged = useCallback((updated: BulkSnoozeReceipt, reminderOnly = false) => {
    readEpoch.current++
    if (updated.id === focusedReplyId && !openDrafts.current.has(updated.id) && !dirtyEditors.current.has(updated.id)) hiddenFocused.current = updated.snooze?.until ? updated.id : null
    // A minimal verification receipt cannot refresh source details or their version.
    setItems(rows => rows.map(row => row.id === updated.id ? { ...row, snooze: updated.snooze, ...(!reminderOnly ? { snoozeVersion: updated.snoozeVersion } : {}) } : row))
  }, [focusedReplyId])
  const trackComposer = useCallback((id: string, open: boolean) => {
    if (open) { readEpoch.current++; openDrafts.current.add(id) }
    else openDrafts.current.delete(id)
  }, [])

  const invalidate = useCallback((cause?: unknown, id?: string) => {
    readEpoch.current++
    abortPages(); setPageTask(null); setPageError(''); pageFailed.current = false
    setLoading(false); loadingRef.current = false
    if (cause instanceof FollowUpClientError && cause.status === 404 && id) {
      setItems(previous => previous.filter(item => item.id !== id))
      openDrafts.current.delete(id); dirtyEditors.current.delete(id)
      rescheduleHolds.current.delete(id); setRescheduleCount(rescheduleHolds.current.size)
      pendingCompletions.current.delete(id); setPendingCompletionCount(pendingCompletions.current.size)
      setFocusedError('This follow-up is no longer available.')
      return
    }
    revokedRef.current = true
    setRevoked(true)
    setWriteAllowed(false); setTaskProgressSupported(false); setTaskOrderSupported(false)
    setNextCursor(null); setPageSupported(false); setCallbackCatchUp(undefined); pagesLoaded.current = 1
    setFilters(emptyFilters)
    setFilterDraft(emptyFilters)
    setFilterError('')
    setItems([])
    approvalLockRef.current = false; setApprovalLocked(false); approvedRetained.current.clear(); bulkRetained.current.clear(); setBulkSelected([])
    openDrafts.current.clear(); dirtyEditors.current.clear()
    pendingCompletions.current.clear(); setPendingCompletionCount(0)
    rescheduleHolds.current.clear(); setRescheduleCount(0)
    setNavigation(null)
    setFocusedError('')
    setError('Access changed. Reload before continuing.')
  }, [abortPages])

  function navigate(target: Navigation, discard = false): boolean {
    if (bulkBusyRef.current) return false
    if (target === status) return true
    if (typeof target === 'object' && 'filters' in target && JSON.stringify(target.filters) === JSON.stringify(filters) && (!target.filters.dueOnly || status === 'PENDING') && (!target.filters.taskProgress || status === 'APPROVED')) { setNavigation(null); setFilterDraft(target.filters); return true }
    if (typeof target === 'object' && 'settings' in target && target.settings.status === status && JSON.stringify(target.settings.filters) === JSON.stringify(filters)) { setNavigation(null); setFilterDraft(target.settings.filters); return true }
    const nextFilters = typeof target === 'object' ? 'settings' in target ? target.settings.status === status ? target.settings.filters : undefined : 'filters' in target ? target.filters : undefined : undefined
    if (status === 'APPROVED' && nextFilters && nextFilters.taskOrder !== filters.taskOrder) {
      const withoutOrder = ({ taskOrder: _order, ...rest }: FollowUpFilters) => rest
      if (JSON.stringify(withoutOrder(nextFilters)) === JSON.stringify(withoutOrder(filters))) {
        setNavigation(null); void readLoadedPages(1, true, false, nextFilters); return true
      }
    }
    if (!discard && (rescheduleHolds.current.size > 0 || pendingCompletions.current.size > 0 || approvalLockRef.current || openDrafts.current.size > 0 || typeof target === 'object' && 'settings' in target && dirtyEditors.current.size > 0)) { setNavigation(target); return false }
    setNavigation(null)
    pendingCompletions.current.clear(); setPendingCompletionCount(0)
    rescheduleHolds.current.clear(); setRescheduleCount(0)
    changeBulkSelection([])
    abortPages(); setPageTask(null); setPageError(''); pageFailed.current = false; pagesLoaded.current = 1; setNextCursor(null); setCallbackCatchUp(undefined)
    readEpoch.current++
    if (typeof target === 'object' && 'settings' in target) { setFilters(target.settings.filters); setFilterDraft(target.settings.filters); setStatus(target.settings.status); setRevision(value => value + 1) }
    else if (typeof target === 'object' && 'filters' in target) { setFilters(target.filters); setFilterDraft(target.filters); if (target.filters.dueOnly) setStatus('PENDING'); else if (target.filters.taskProgress || target.filters.taskOrder) setStatus('APPROVED'); setRevision(value => value + 1) }
    else if (typeof target === 'object') { setFilters(current => filtersForFollowUpTab(current, 'PENDING')); setFilterDraft(current => filtersForFollowUpTab(current, 'PENDING')); setFocusedReplyId(target.replyId); setStatus('PENDING'); setRevision(value => value + 1) }
    else if (target === 'refresh') setRevision(value => value + 1)
    else { setFilters(current => filtersForFollowUpTab(current, target)); setFilterDraft(current => filtersForFollowUpTab(current, target)); setStatus(target) }
    return true
  }

  function applyFilters() {
    const parsed = followUpFilterSchema.safeParse(filterDraft)
    if (!parsed.success) { setFilterError('Use a search of up to 200 characters and valid filters.'); return }
    setFilterError(''); navigate({ filters: parsed.data })
  }

  useEffect(() => {
    if (initialReplyId !== focusedReplyId) navigate({ replyId: initialReplyId })
    // Incoming review links use the same open-draft confirmation as refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialReplyId])
  useEffect(() => {
    let current = true
    if (revokedRef.current) return
    if (retainedOrderCommit.current === filters) { retainedOrderCommit.current = null; return }
    const epoch = ++readEpoch.current, request = new AbortController()
    abortPages(); setPageTask(null); setPageError(''); pageFailed.current = false; pagesLoaded.current = 1; setNextCursor(null); setPageSupported(false); setCallbackCatchUp(undefined)
    loadingRef.current = true
    const emailContext = emailOrganizationId && emailUserId ? { organizationId: emailOrganizationId, userId: emailUserId } : undefined
    setLoading(true)
    setError(null)
    setItems([])
    setFocusedError('')
    const focused = focusedReplyId && emailContext && status === 'PENDING' ? fetch(`/api/email-notifications/follow-up/${focusedReplyId}`, { cache: 'no-store', headers: emailNotificationHeaders(emailContext), signal: request.signal })
      .then(response => emailNotificationData(response, emailContext))
      .then(value => { const item = focusedEmailReply.parse(value); if (item.id !== focusedReplyId) throw new Error('The requested email reply changed. Refresh to try again.'); return item })
      .catch(cause => { if (cause instanceof EmailNotificationError && ([401, 403].includes(cause.status) || /CONTEXT|WORKSPACE/.test(cause.code))) throw cause; if (current) setFocusedError(cause instanceof Error ? cause.message : 'Requested reply is no longer available.'); return null }) : Promise.resolve(null)
    Promise.all([readFollowUpPages<FollowUpItem>({ status, filters, context: emailContext, depth: 1, retained: [], signal: request.signal }), focused])
      .then(([result, item]) => { if (current && epoch === readEpoch.current && !revokedRef.current) { const rows = result.items; setNextCursor(result.nextCursor); setPageSupported(result.paged); setCallbackCatchUp(result.callbackCatchUp); pagesLoaded.current = result.pages; setWriteAllowed(result.canWrite ?? canWrite); setTaskProgressSupported(result.taskProgress === true); setTaskOrderSupported(result.taskOrder === true); setItems(item ? [item, ...rows.filter(row => row.id !== item.id)] : focusedReplyId && emailContext && status === 'PENDING' ? rows.filter(row => row.id !== focusedReplyId) : rows) } })
      .catch((cause) => { if (current) { if (followUpAccessLost(cause) || cause instanceof EmailNotificationError && ([401, 403].includes(cause.status) || /CONTEXT|WORKSPACE/.test(cause.code))) invalidate(cause); else setError(cause instanceof Error ? cause.message : 'Unable to load follow-ups.') } })
      .finally(() => { if (current) { loadingRef.current = false; setLoading(false) } })
    return () => { current = false; request.abort() }
  }, [status, filters, revision, focusedReplyId, emailOrganizationId, emailUserId, canWrite, invalidate, abortPages])

  const readLoadedPages = useCallback(async function revalidatePages(depth: number, explicit: boolean, catchUp = false, orderFilters?: FollowUpFilters): Promise<void> {
    if (loadingRef.current || revokedRef.current || bulkBusyRef.current || (!explicit && pageFailed.current)) return
    if (pageController.current) { if (!explicit) pendingRevalidation.current = true; return }
    const request = new AbortController(), epoch = readEpoch.current
    pageController.current = request; retryDepth.current = depth; pageFailed.current = false
    const draftAtStart = filterDraftRef.current
    retryOrder.current = orderFilters
    retryCatchUp.current = catchUp
    setPageTask(catchUp ? 'catch-up' : depth > pagesLoaded.current ? 'more' : 'refresh'); setPageError('')
    const active = () => pageController.current === request && !request.signal.aborted
    const retained = new Set([...openDrafts.current, ...dirtyEditors.current, ...bulkRetained.current, ...pendingCompletions.current, ...rescheduleHolds.current.keys(), ...(focusedReplyId && focusedReplyId !== hiddenFocused.current ? [focusedReplyId] : [])])
    try {
      const result = await readFollowUpPages<FollowUpItem>({ status, filters: orderFilters ?? filters, context: emailOrganizationId && emailUserId ? { organizationId: emailOrganizationId, userId: emailUserId } : undefined, depth, retained: [...retained], signal: request.signal })
      if (!active() || revokedRef.current) return
      if (epoch !== readEpoch.current) { if (explicit) { pageFailed.current = true; setPageError('The list changed while loading. Retry to continue with your current drafts.') }; return }
      if (orderFilters) { retainedOrderCommit.current = orderFilters; setFilters(orderFilters); setFilterDraft(current => current === draftAtStart ? orderFilters : current); retryOrder.current = undefined }
      setItems(result.items); setWriteAllowed(result.canWrite ?? canWrite); setTaskProgressSupported(result.taskProgress === true); setTaskOrderSupported(result.taskOrder === true); pagesLoaded.current = result.pages
      setNextCursor(result.nextCursor); setPageSupported(result.paged); setCallbackCatchUp(result.callbackCatchUp)
    } catch (cause) {
      if (!active()) return
      if (followUpAccessLost(cause)) { invalidate(cause); return }
      pageFailed.current = true
      setPageError(epoch !== readEpoch.current ? 'The list changed while loading. Retry to continue with your current drafts.' : cause instanceof Error ? cause.message : 'Unable to load follow-ups. Retry to continue.')
    } finally { if (active()) { pageController.current = null; setPageTask(null); const again = !orderFilters && pendingRevalidation.current && !pageFailed.current && !revokedRef.current && !bulkBusyRef.current; pendingRevalidation.current = false; if (again) void revalidatePages(pagesLoaded.current, false) } }
  }, [status, filters, emailOrganizationId, emailUserId, focusedReplyId, canWrite, invalidate])
  useEffect(() => () => abortPages(), [abortPages])
  useEffect(() => {
    if (!emailOrganizationId || !emailUserId || revoked) return
    const revalidate = () => { if (document.visibilityState === 'visible') void readLoadedPages(pagesLoaded.current, false) }
    const timer = window.setInterval(revalidate, 60000)
    window.addEventListener('focus', revalidate); document.addEventListener('visibilitychange', revalidate)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', revalidate); document.removeEventListener('visibilitychange', revalidate) }
  }, [emailOrganizationId, emailUserId, revoked, readLoadedPages])

  useEffect(() => {
    if (approvalLocked && writeAllowed) return
    const valid = new Set(items.filter(row => canBulkSnooze(row) || approvedRetained.current.has(row.id) && row.status === 'APPROVED').map(row => row.id))
    if (!writeAllowed || bulkSelected.some(id => !valid.has(id))) {
      const next = writeAllowed ? bulkSelected.filter(id => valid.has(id)) : []
      if (next.length !== bulkSelected.length) { bulkRetained.current = new Set(next); readEpoch.current++; setBulkSelected(next) }
    }
  }, [items, writeAllowed, bulkSelected, approvalLocked])

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow text-muted-foreground">Your next steps</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Follow-up inbox</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Review incoming replies and callback requests. Approve a task, or open a draft to review and send.</p>
        </div>
        <Button type="button" variant="outline" onClick={() => navigate('refresh')} disabled={loading || bulkBusy || revoked}>
          <RotateCw className="mr-2 size-4" aria-hidden="true" />Refresh
        </Button>
      </div>
      {children}
      {emailMatchContext && !revoked && <EmailMatchInbox context={emailMatchContext} initialMessageId={initialMessageId} canWrite={writeAllowed} onResolved={() => navigate('refresh')} />}
      {emailMatchContext && !revoked && <details className="min-w-0 rounded-lg border bg-card p-4" onToggle={event => event.currentTarget.open && setViewsOpen(true)}><summary className="cursor-pointer rounded text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">Saved views</summary>{viewsOpen && <div className="mt-3"><SavedFollowUpViews context={emailMatchContext} settings={{ status, filters }} disabled={loading || bulkBusy} onApply={settings => { setFilterError(''); navigate({ settings }) }} onAccessLost={invalidate} /></div>}</details>}
      {navigation && rescheduleCount > 0 ? <section role="group" aria-label="Task rescheduling navigation" className="rounded-lg border bg-card p-4"><p className="text-sm">A deadline edit or unconfirmed rescheduling result is open. Continuing discards the editor, exact request check, and any unsent draft edits. Saved task changes are kept.</p><div className="mt-3 flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => setNavigation(null)}>Stay with rescheduling</Button><Button type="button" onClick={() => navigate(navigation, true)}>Leave rescheduling</Button></div></section> : navigation && pendingCompletionCount > 0 ? <section role="group" aria-label="Unconfirmed task completion navigation" className="rounded-lg border bg-card p-4"><p className="text-sm">Check the completion result before leaving. Continuing loses the exact request check and discards any unsent draft edits. It does not undo a completed task.</p><div className="mt-3 flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => setNavigation(null)}>Stay and check completion</Button><Button type="button" onClick={() => navigate(navigation, true)}>Leave without checking</Button></div></section> : navigation && <section role="group" aria-label={approvalLocked ? "Approval results confirmation" : "Open draft confirmation"} className="rounded-lg border bg-card p-4"><p className="text-sm">{approvalLocked ? 'Task approval results are still open. Continuing discards these results and any open email draft edits. Approved tasks are kept.' : typeof navigation === 'object' && 'settings' in navigation ? 'You have unsaved follow-up edits. Applying this view will discard them.' : 'You have an open email draft. Continuing will discard its unsent edits.'}</p><div className="mt-3 flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => setNavigation(null)}>Keep editing</Button><Button type="button" onClick={() => navigate(navigation, true)}>{typeof navigation === 'object' ? 'settings' in navigation ? 'Discard and apply view' : 'filters' in navigation ? 'Discard and apply filters' : 'Discard and open reply' : navigation === 'refresh' ? 'Discard and refresh' : 'Discard and change tab'}</Button></div></section>}
      {snoozeNotice && <p role="status" className="text-sm">{snoozeNotice}</p>}
      {focusedError && <p role="alert" className="text-sm text-destructive">{focusedError}</p>}
      <section role="search" aria-label="Follow-up filters" className="space-y-3 rounded-lg border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <label className="grid gap-1.5 text-sm font-medium">Search follow-ups<input type="search" className={fieldClass} maxLength={200} value={filterDraft.search} disabled={revoked} placeholder="Lead name, email or follow-up title" onChange={event => { setFilterError(''); setFilterDraft(current => ({ ...current, search: event.target.value })) }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (!loading && !revoked && !retryOrder.current) applyFilters() } }} /></label>
          <label className="grid gap-1.5 text-sm font-medium">Follow-up source<select className={fieldClass} value={filterDraft.source} disabled={revoked} onChange={event => setFilterDraft(current => ({ ...current, source: event.target.value as FollowUpFilters['source'] }))}><option value="ALL">All sources</option><option value="EMAIL">Email replies</option><option value="CALL">Callbacks</option></select></label>
        </div>
        {status === 'APPROVED' && <label className="grid gap-1.5 text-sm font-medium">Task progress<select aria-label="Task progress" aria-describedby={taskProgressDescription} className={fieldClass} value={filterDraft.taskProgress ?? ''} disabled={revoked || !taskProgressSupported} onChange={event => { const value = event.target.value as FollowUpFilters['taskProgress']; setFilterDraft(({ taskProgress: _previous, ...current }) => ({ ...current, dueOnly: false, ...(value ? { taskProgress: value } : {}) })) }}><option value="">All tasks</option><option value="OPEN">Open · including overdue</option><option value="OVERDUE">Overdue</option><option value="COMPLETED">Completed</option></select><span id={taskProgressDescription} className="text-xs font-normal text-muted-foreground">{taskProgressSupported ? 'Progress is checked by the server. Task completion requires review and confirmation. Unavailable tasks are excluded from progress filters.' : 'Task progress is unavailable. Reload to check support.'}</span></label>}
        {status === 'APPROVED' && <label className="grid gap-1.5 text-sm font-medium">Task order<select aria-label="Task order" className={fieldClass} value={filterDraft.taskOrder ?? ''} disabled={revoked || !taskOrderSupported || !taskProgressSupported || pageTask !== null} onChange={event => { const value = event.target.value as FollowUpFilters['taskOrder']; setFilterDraft(({ taskOrder: _previous, ...current }) => ({ ...current, dueOnly: false, ...(value ? { taskOrder: value } : {}) })) }}><option value="">Newest follow-ups</option><option value="DUE_ASC">Earliest task deadline</option></select><span className="text-xs font-normal text-muted-foreground">{taskOrderSupported ? 'Overdue first, then upcoming deadlines. Unavailable tasks appear last. Changing only order keeps unsent drafts.' : 'Deadline ordering is unavailable. Reload to check support.'}</span></label>}
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={filterDraft.dueOnly} disabled={revoked} onChange={event => setFilterDraft(current => ({ ...(event.target.checked ? filtersForFollowUpTab(current, 'PENDING') : current), dueOnly: event.target.checked }))} />Due reminders only</label>
        <p className="text-xs text-muted-foreground">Search includes older accessible follow-ups. Due reminders are elapsed snoozes awaiting review in Pending. Apply to update the list.</p>
        <div className="flex flex-wrap gap-2"><Button type="button" disabled={loading || revoked || bulkBusy || pageTask !== null && retryOrder.current !== undefined} onClick={applyFilters}>Apply filters</Button><Button type="button" variant="outline" disabled={loading || revoked || bulkBusy} onClick={() => { setFilterError(''); setFilterDraft(emptyFilters); navigate({ filters: emptyFilters }) }}>Clear filters</Button></div>
        {filterError && <p role="alert" className="text-sm text-destructive">{filterError}</p>}
        <p className="break-words text-xs text-muted-foreground">{hasFollowUpFilters(filters) ? `Applied: ${filters.search ? `Search “${filters.search}” · ` : ''}${filters.source === 'ALL' ? 'All sources' : filters.source === 'EMAIL' ? 'Email replies' : 'Callbacks'}${filters.dueOnly ? ' · Due reminders only' : ''}${filters.taskProgress ? ` · ${filters.taskProgress === 'OPEN' ? 'Open tasks' : filters.taskProgress === 'OVERDUE' ? 'Overdue tasks' : 'Completed tasks'}` : ''}` : 'Applied: all follow-ups in this tab.'} {status === 'APPROVED' && (filters.taskOrder ? 'Order: earliest task deadline. ' : 'Order: newest follow-ups. ')}Open drafts and focused replies can appear outside the filters.</p>
      </section>
      {!loading && !revoked && callbackCatchUp && <section aria-label="Callback catch-up" aria-busy={pageTask === 'catch-up'} className="space-y-3 rounded-lg border bg-card p-4">
        <h2 className="text-sm font-medium">Callback catch-up</h2>
        <p role="status" className="text-sm">{`Last confirmed check added ${callbackCatchUp.created} callback follow-up${callbackCatchUp.created === 1 ? '' : 's'}.`}</p>
        <p className="text-sm text-muted-foreground">{callbackCatchUp.hasMore ? 'Older callbacks remain. Continue to add up to 100 at a time.' : 'No older callbacks are waiting to be added.'}</p>
        <p className="text-xs text-muted-foreground">Catch-up includes all accessible callbacks. New follow-ups appear in Pending; your filters stay applied.</p>
        {pageTask === 'catch-up' && <p role="status" className="text-sm">Catching up callbacks…</p>}
        {pageError && retryCatchUp.current && <p role="alert" className="text-sm text-destructive">{pageError}</p>}
        <div className="flex flex-wrap gap-2">{callbackCatchUp.hasMore && <Button type="button" variant="outline" disabled={pageTask !== null || Boolean(pageError)} onClick={() => void readLoadedPages(pagesLoaded.current, true, true)}>Continue catch-up</Button>}{pageError && retryCatchUp.current && <Button type="button" variant="outline" disabled={pageTask !== null || bulkBusy} onClick={() => void readLoadedPages(retryDepth.current, true, true)}>Retry catch-up</Button>}</div>
      </section>}
      {approvalLocked && <p role="status" className="text-sm">Task approval results are kept. Check or clear approval results before starting another bulk action.</p>}
      {!loading && !revoked && writeAllowed && emailMatchContext && <details className="min-w-0 rounded-lg border bg-card p-4" onToggle={event => { if (event.currentTarget.open) setApprovalOpen(true) }}><summary className="cursor-pointer rounded text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">Bulk task approval</summary>{approvalOpen && <div className="mt-3"><FollowUpBulkApproval key={JSON.stringify([status, filters, revision])} items={items} selectedIds={bulkSelected} blockedIds={[...dirtyEditors.current]} context={emailMatchContext} disabled={!writeAllowed} otherBusy={bulkBusy && !approvalBusy} refreshing={pageTask !== null} onSelectionChange={changeBulkSelection} onChanged={bulkApprovalChanged} onAccessLost={invalidate} onBusyChange={changeApprovalBusy} onRetainReview={retainApprovalReview} /></div>}</details>}
      {!loading && !revoked && writeAllowed && emailMatchContext && (items.some(canBulkSnooze) || bulkSelected.length > 0) && <FollowUpBulkSnooze key={JSON.stringify([status, filters, revision])} items={items} selectedIds={bulkSelected} onSelectionChange={changeBulkSelection} context={emailMatchContext} disabled={!writeAllowed || approvalBusy || approvalLocked} onChanged={bulkSnoozeChanged} onVerified={row => bulkSnoozeChanged(row, true)} onRefresh={() => void readLoadedPages(pagesLoaded.current, true)} refreshing={pageTask !== null} onAccessLost={invalidate} onBusyChange={changeBulkBusy} />}
      <div role="tablist" aria-label="Follow-up status" className="flex w-fit max-w-full flex-wrap gap-1 rounded-lg border bg-muted/40 p-1">
        {tabs.map((tab) => <button key={tab.value} id={`follow-ups-${tab.value}`} type="button" role="tab" disabled={bulkBusy} aria-selected={status === tab.value} aria-controls="follow-up-panel" tabIndex={status === tab.value ? 0 : -1} onKeyDown={(event) => {
          const index = tabs.findIndex((value) => value.value === tab.value)
          const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1
          if (next < 0) return
          event.preventDefault()
          if (navigate(tabs[next].value)) document.getElementById(`follow-ups-${tabs[next].value}`)?.focus()
        }} onClick={() => navigate(tab.value)} className={cn('rounded-md px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring', status === tab.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{tab.label}</button>)}
      </div>
      {!writeAllowed && <p className="text-sm text-muted-foreground">You have read-only access. Ask a team member with lead editing permission to review these follow-ups.</p>}
      <section id="follow-up-panel" role="tabpanel" aria-labelledby={`follow-ups-${status}`} aria-busy={loading} className="min-w-0">
        {loading ? <p role="status" className="py-12 text-center text-sm text-muted-foreground">Loading follow-ups…</p> : error ? <div className="rounded-lg border bg-card p-6"><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="outline" className="mt-3" onClick={() => navigate('refresh')}>Try again</Button></div> : items.length === 0 ? <div className="flex flex-col items-center rounded-xl border border-dashed bg-card px-5 py-14 text-center"><Inbox className="mb-3 size-7 text-muted-foreground" aria-hidden="true" /><h2 className="font-medium">{hasFollowUpFilters(filters) ? 'No follow-ups match these filters.' : `No ${status.toLowerCase()} follow-ups`}</h2><p className="mt-1 max-w-md text-sm text-muted-foreground">{status === 'PENDING' ? 'New replies from synced sales conversations and confirmed receptionist callbacks will appear here.' : 'Reviewed follow-ups will appear here.'}</p></div> : <div className="grid min-w-0 gap-4">{items.map((item) => <div key={item.id} className="space-y-2">{writeAllowed && emailMatchContext && canBulkSnooze(item) && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" aria-label={`${approvalOpen ? 'Select follow-up for bulk actions' : 'Select follow-up for'} ${item.lead.firstName} ${item.lead.lastName}: ${item.title}`} checked={bulkSelected.includes(item.id)} disabled={bulkBusy || approvalLocked || (!bulkSelected.includes(item.id) && bulkSelected.length >= BULK_SNOOZE_LIMIT)} onChange={event => changeBulkSelection(event.target.checked ? [...bulkSelected, item.id] : bulkSelected.filter(id => id !== item.id))} />{approvalOpen && canBulkApprove(item) ? 'Select for bulk actions' : 'Select for bulk snooze'}</label>}<FollowUpCard item={item} showTaskProgress={status === 'APPROVED'} taskProgressSupported={taskProgressSupported} batchBusy={bulkBusy} canWrite={writeAllowed} context={emailMatchContext} onRescheduleHoldChange={retainReschedule} onTaskRescheduled={taskRescheduled} rescheduleBlocked={pendingCompletionCount > 0} completionBlocked={rescheduleCount > 0} onCompletionPendingChange={retainCompletion} onCompletionBusyChange={changeBulkBusy} onTaskCompleted={taskCompleted} onAccessLost={invalidate} onComposerChange={trackComposer} onEditorChange={trackEditor} onSnoozeChanged={(updated) => {
          readEpoch.current++; hiddenFocused.current = updated.id; openDrafts.current.delete(updated.id)
          setItems(current => current.flatMap(row => row.id !== updated.id ? [row] : (status === 'SNOOZED' && updated.snooze?.until || status === 'PENDING' && !filters.dueOnly && !updated.snooze?.until) ? [{ ...row, ...updated }] : []))
          setSnoozeNotice(updated.snooze?.until ? 'Follow-up snoozed. Find it in Snoozed.' : 'Follow-up awake. Find it in Pending.')
          window.dispatchEvent(new Event(EMAIL_NOTIFICATION_EVENT))
        }} /></div>)}</div>}
      </section>
      {!loading && !revoked && (pageSupported || pageError) && <section aria-label="Follow-up pagination" className="space-y-3">
        {pageTask && pageTask !== 'catch-up' && <p role="status" className="text-sm text-muted-foreground">{pageTask === 'more' ? 'Loading more follow-ups…' : 'Checking follow-ups…'}</p>}
        {pageError && !retryCatchUp.current && <p role="alert" className="text-sm text-destructive">{pageError}</p>}
        <div className="flex flex-wrap gap-2">{nextCursor && <Button type="button" variant="outline" disabled={pageTask !== null || bulkBusy} onClick={() => void readLoadedPages(pagesLoaded.current + 1, true)}>Load more</Button>}{pageError && !retryCatchUp.current && <Button type="button" variant="outline" disabled={pageTask !== null || bulkBusy} onClick={() => void readLoadedPages(retryDepth.current, true, false, retryOrder.current)}>Retry loading</Button>}</div>
        {pageSupported && !nextCursor && !callbackCatchUp?.hasMore && !pageTask && !pageError && <p className="text-xs text-muted-foreground">All matching follow-ups are loaded.</p>}
      </section>}
      <p className="text-xs text-muted-foreground">{pageSupported ? `${items.length} loaded items assigned to you, including retained drafts and focused replies. Load more keeps your filters and unsent drafts.` : 'Showing up to 100 recent items assigned to you, plus open drafts and a focused reply.'} Email sources are previews, and draft text is a starting template. Approving a task does not send an email.</p>
    </div>
  )
}

function FollowUpCard({ item, canWrite, context, showTaskProgress = false, taskProgressSupported = false, batchBusy = false, onRescheduleHoldChange, onTaskRescheduled, rescheduleBlocked, completionBlocked, onCompletionPendingChange, onCompletionBusyChange, onTaskCompleted, onAccessLost, onComposerChange, onEditorChange, onSnoozeChanged }: { item: FollowUpItem; canWrite: boolean; context?: FollowUpContext; showTaskProgress?: boolean; taskProgressSupported?: boolean; batchBusy?: boolean; onRescheduleHoldChange: (id: string, hold: RescheduleHold) => void; onTaskRescheduled: (receipt: Extract<TaskRescheduleReceipt, { state: 'confirmed' }>) => void; rescheduleBlocked: boolean; completionBlocked: boolean; onCompletionPendingChange: (id: string, pending: boolean) => void; onCompletionBusyChange: (busy: boolean) => void; onTaskCompleted: (receipt: Extract<TaskCompletionReceipt, { state: 'confirmed' }>) => void; onAccessLost: (cause?: unknown, id?: string) => void; onComposerChange: (id: string, open: boolean) => void; onEditorChange: (id: string, dirty: boolean) => void; onSnoozeChanged: (item: Pick<FollowUpItem, 'id' | 'snoozeVersion' | 'snooze'>) => void }): React.JSX.Element {
  const [title, setTitle] = useState(item.title)
  const [description, setDescription] = useState(item.description)
  const [dueDate, setDueDate] = useState('')
  const [result, setResult] = useState(item)
  const [busy, setBusy] = useState(false)
  const [snoozing, setSnoozing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [compose, setCompose] = useState(false)
  useEffect(() => {
    onComposerChange(item.id, compose)
    return () => onComposerChange(item.id, false)
  }, [compose, item.id, onComposerChange])
  const [instructions, setInstructions] = useState('')
  const [generating, setGenerating] = useState(false)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const requestVersion = useRef(0)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { if (!canWrite) { requestVersion.current++; setCompose(false); setConfirmReplace(false); setGenerating(false); setBusy(false) } }, [canWrite])
  useEffect(() => {
    setResult(current => ({ ...current, status: item.status, taskId: item.taskId, ...(item.status === 'APPROVED' ? { title: item.title, description: item.description } : {}), snooze: item.snooze, snoozeVersion: item.snoozeVersion }))
    if (item.status === 'DISMISSED') { requestVersion.current++; setCompose(false); setConfirmReplace(false) }
  }, [item.status, item.taskId, item.title, item.description, item.snooze, item.snoozeVersion])
  const generated = Boolean(result.draftVersion && result.draftContext)
  const recipient = generated ? result.draftContext!.recipientEmail : item.lead.email
  const canGenerate = canWrite && result.sourceType === 'EMAIL' && result.status !== 'DISMISSED'

  async function generateDraft(replace = false): Promise<void> {
    if (generating || busy || snoozing || batchBusy || !canGenerate) return
    if (compose && !replace) { setConfirmReplace(true); return }
    setConfirmReplace(false)
    setGenerating(true)
    setError(null)
    const version = ++requestVersion.current
    try {
      const data = await responseData<GeneratedDraft>(await fetch(`/api/follow-ups/${item.id}/draft`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(context ? followUpHeaders(context) : {}) }, body: JSON.stringify({ instructions: instructions.trim() }) }), context)
      if (!mounted.current || version !== requestVersion.current) return
      setResult(current => current.status === 'DISMISSED' ? current : { ...current, draftSubject: data.subject, draftBody: data.body, draftVersion: data.version, draftGeneratedAt: data.generatedAt, draftContext: data.context })
      setCompose(false)
      setNotice('Contextual draft generated. Review it before sending.')
    } catch (cause) {
      if (followUpAccessLost(cause)) { if (mounted.current) onAccessLost(cause, item.id); return }
      if (mounted.current && version === requestVersion.current) setError(cause instanceof Error ? cause.message : 'Unable to generate this draft.')
    } finally {
      if (mounted.current && version === requestVersion.current) setGenerating(false)
    }
  }
  const pending = result.status === 'PENDING'
  const editable = pending && canWrite
  const dirty = canWrite && ((editable && !result.taskId && (title !== item.title || description !== item.description || dueDate !== '')) || instructions.trim() !== '')
  useEffect(() => { onEditorChange(item.id, dirty); return () => onEditorChange(item.id, false) }, [dirty, item.id, onEditorChange])
  const fullName = `${item.lead.firstName} ${item.lead.lastName}`.trim() || 'Lead'
  const Icon = item.sourceType === 'CALL' ? Phone : Mail

  async function review(action: 'approve' | 'dismiss'): Promise<void> {
    if (busy || snoozing || batchBusy || !editable) return
    setBusy(true)
    const version = ++requestVersion.current
    setGenerating(false)
    setConfirmReplace(false)
    setError(null)
    try {
      const data = await responseData<FollowUpItem>(await fetch(`/api/follow-ups/${item.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(context ? followUpHeaders(context) : {}) },
        body: JSON.stringify(action === 'dismiss' ? { action } : { action, title: title.trim(), description: description.trim(), ...(dueDate ? { dueDate: new Date(`${dueDate}T00:00:00.000Z`).toISOString() } : {}) }),
      }), context)
      if (!mounted.current || version !== requestVersion.current) return
      setResult(current => ({ ...current, ...data }))
      if (action === 'dismiss') setCompose(false)
      window.dispatchEvent(new Event(EMAIL_NOTIFICATION_EVENT))
      setNotice(action === 'approve' ? 'Follow-up approved. Your task is ready.' : 'Follow-up dismissed.')
    } catch (cause) {
      if (!mounted.current || version !== requestVersion.current) return
      if (followUpAccessLost(cause)) { onAccessLost(cause, item.id); return }
      setError(cause instanceof Error ? cause.message : 'Unable to update this follow-up.')
    } finally {
      if (mounted.current && version === requestVersion.current) setBusy(false)
    }
  }

  return (
    <article id={`follow-up-${item.id}`} aria-label={`Follow-up for ${fullName}`} className="min-w-0 rounded-xl border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2"><Icon className="size-4 shrink-0 text-brand" aria-hidden="true" /><Link className="break-words text-sm font-semibold underline-offset-4 hover:underline" href={`/leads/${item.lead.id}`}>{fullName}</Link><span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{result.status.toLowerCase()}</span></div>
        <time dateTime={item.createdAt} className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleDateString()}</time>
      </div>
      <div className="mt-4 rounded-lg bg-muted/50 p-3"><h2 className="text-xs font-medium text-muted-foreground">{item.sourceType === 'CALL' ? 'Call summary' : 'Email preview'}</h2><p className="mt-1 whitespace-pre-wrap break-words text-sm">{item.sourceText || 'No preview available. Open the lead to review the conversation.'}</p></div>
      {editable && !result.taskId ? <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px]">
        <label className="grid gap-1.5 text-sm font-medium">Task title<input className={fieldClass} value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} disabled={busy || snoozing || batchBusy} required /></label>
        <label className="grid gap-1.5 text-sm font-medium">Due date<input className={fieldClass} type="date" aria-label="Due date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} disabled={busy || snoozing || batchBusy} /><span className="text-xs font-normal text-muted-foreground">Optional · UTC date</span></label>
        <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">Task description<textarea className={fieldClass} rows={3} value={description} maxLength={10000} onChange={(event) => setDescription(event.target.value)} disabled={busy || snoozing || batchBusy} /></label>
      </div> : <div className="mt-4"><h3 className="break-words text-sm font-medium">{result.title}</h3><p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{result.description}</p>{result.taskId && pending && <p className="mt-2 text-xs text-muted-foreground">A callback task already exists. Marking this reviewed keeps the existing task.</p>}</div>}
      {showTaskProgress && result.status === 'APPROVED' && <FollowUpTaskProgress progress={taskProgressSupported ? item.taskProgress : undefined} />}
      {showTaskProgress && taskProgressSupported && result.status === 'APPROVED' && context && <FollowUpTaskCompletion key={JSON.stringify([item.id, result.taskId, context.organizationId, context.userId])} id={item.id} taskId={result.taskId} progress={item.taskProgress} context={context} canWrite={canWrite} disabled={busy || generating || snoozing || batchBusy || completionBlocked} onChanged={onTaskCompleted} onPendingChange={onCompletionPendingChange} onBusyChange={onCompletionBusyChange} onAccessLost={onAccessLost} />}
      {showTaskProgress && taskProgressSupported && result.status === 'APPROVED' && context && <FollowUpTaskReschedule key={JSON.stringify(['reschedule', item.id, result.taskId, context.organizationId, context.userId])} id={item.id} taskId={result.taskId} progress={item.taskProgress} context={context} canWrite={canWrite} disabled={busy || generating || snoozing || batchBusy || rescheduleBlocked} onChanged={onTaskRescheduled} onHoldChange={onRescheduleHoldChange} onBusyChange={onCompletionBusyChange} onAccessLost={onAccessLost} />}
      {pending && result.snooze?.until && <p className="mt-3 text-sm">Snoozed review · {new Date(result.snooze.until).toLocaleString()}</p>}
      {editable && context && result.snoozeVersion && <FollowUpSnoozeControls item={result} context={context} onBusyChange={setSnoozing} disabled={busy || generating || batchBusy} compose={compose} onDiscard={() => setCompose(false)} onChanged={onSnoozeChanged} onAccessLost={onAccessLost} />}
      {canGenerate && <div className="mt-4 grid gap-2"><label className="grid gap-1.5 text-sm font-medium">Draft instructions<textarea className={fieldClass} rows={2} maxLength={2000} value={instructions} onChange={event => setInstructions(event.target.value)} disabled={generating || busy || snoozing || batchBusy} placeholder="Optional: ask about their timeline, or keep the reply brief" /></label><p className="text-xs text-muted-foreground">Generate from the full email conversation. Attachments are excluded.</p><Button type="button" variant="outline" className="w-fit" disabled={generating || busy || snoozing || batchBusy} onClick={() => void generateDraft()}>{generating ? 'Generating draft…' : generated ? 'Regenerate contextual draft' : 'Generate contextual draft'}</Button></div>}
      {confirmReplace && <div className="mt-3 rounded-lg border p-3" role="group" aria-label="Replace open draft confirmation"><p className="text-sm">A draft is open. Regenerating will replace it and discard its edits after generation succeeds.</p><div className="mt-2 flex flex-wrap gap-2"><Button type="button" onClick={() => void generateDraft(true)}>Replace open draft</Button><Button type="button" variant="outline" onClick={() => setConfirmReplace(false)}>Keep editing</Button></div></div>}
      {generated && result.draftContext && <div className="mt-3 break-words text-xs text-muted-foreground"><p>Generated from {result.draftContext.messageCount} messages · {result.draftContext.provider === 'gmail' ? 'Gmail' : 'Microsoft 365'} {result.draftContext.mailboxEmail ? `mailbox ${result.draftContext.mailboxEmail}` : 'mailbox'}</p><p>Reply to {result.draftContext.recipientEmail} in the source conversation</p>{result.draftGeneratedAt && <p>Generated <time dateTime={result.draftGeneratedAt}>{new Date(result.draftGeneratedAt).toLocaleString()}</time></p>}</div>}
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="mt-3 flex items-center gap-1.5 text-sm text-brand"><Check className="size-4" aria-hidden="true" />{notice}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {editable && <><Button type="button" disabled={busy || snoozing || batchBusy || (!result.taskId && !title.trim())} onClick={() => void review('approve')}>{busy ? 'Saving…' : result.taskId ? 'Mark reviewed' : 'Approve task'}</Button><Button type="button" variant="outline" disabled={busy || snoozing || batchBusy} onClick={() => void review('dismiss')}>Dismiss</Button></>}
        {result.taskId && !(showTaskProgress && taskProgressSupported && item.taskProgress?.state === 'UNAVAILABLE') && <Link className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`/tasks/${result.taskId}`}>Open task</Link>}
        {canWrite && result.status !== 'DISMISSED' && recipient && result.draftBody && <Button type="button" variant="outline" disabled={busy || generating || snoozing} onClick={() => setCompose((value) => !value)}>{compose ? 'Close draft' : 'Review email draft'}</Button>}
      </div>
      {showTaskProgress && taskProgressSupported && result.status === 'APPROVED' && context && result.taskId && item.taskProgress && item.taskProgress.state !== 'UNAVAILABLE' && <FollowUpTaskHistory id={item.id} taskId={result.taskId} context={context} revision={JSON.stringify([item.taskProgress.state, item.taskProgress.dueDate, item.taskProgress.completedAt])} onAccessLost={onAccessLost} />}
      {context && <FollowUpHistory id={item.id} context={context} revision={`${result.status}:${result.taskId}:${result.snoozeVersion}`} onAccessLost={onAccessLost} />}
      {compose && canWrite && result.status !== 'DISMISSED' && result.draftBody && recipient && <div className="mt-5 min-w-0 border-t pt-5"><p className="mb-3 text-xs text-muted-foreground">{generated ? 'Review and edit this contextual reply before sending. The recipient, mailbox and conversation are bound to this draft.' : 'Review and edit this template before sending. This starts a new email; check the subject and recipient.'}</p><EmailCompose key={result.draftVersion ?? 'template'} leadId={item.lead.id} leadEmail={recipient} leadName={fullName} defaultSubject={result.draftSubject ?? ''} defaultBody={draftHtml(result.draftBody)} followUpId={item.id} followUpContext={context} onAccessLost={() => onAccessLost(undefined, item.id)} {...(generated ? { draftVersion: result.draftVersion!, replyToThreadId: result.draftContext!.threadId, replySubject: result.draftSubject ?? '' } : {})} onSent={() => { setCompose(false); setNotice('Email sent. Task review is tracked separately.') }} /></div>}
    </article>
  )
}
