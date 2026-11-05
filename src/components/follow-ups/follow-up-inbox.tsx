'use client'

import Link from 'next/link'
import { EMAIL_NOTIFICATION_EVENT, focusedEmailReply } from '@/lib/email-notifications'
import { EmailNotificationError, emailNotificationData, emailNotificationHeaders } from '@/lib/email-notification-client'
import { EmailMatchInbox, type EmailMatchContext } from './email-match-inbox'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Inbox, Mail, Phone, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmailCompose } from '@/components/email/email-compose'
import { followUpHeaders, type FollowUpContext } from '@/lib/follow-up-access'
import { followUpAccessLost, followUpData, FollowUpClientError } from '@/lib/follow-up-client'
import { cn } from '@/lib/utils'

type FollowUpStatus = 'PENDING' | 'APPROVED' | 'DISMISSED'
type Navigation = 'refresh' | FollowUpStatus | { replyId: string | undefined }

export interface FollowUpItem {
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

const tabs: { value: FollowUpStatus; label: string }[] = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'DISMISSED', label: 'Dismissed' },
]
const fieldClass = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60'

function draftHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\r?\n/g, '<br />')
}

async function responseData<T>(response: Response, context?: FollowUpContext): Promise<T> {
  return (await followUpData<T>(response, context)).data
}

export function FollowUpInbox({ canWrite, children, emailMatchContext, initialMessageId, initialReplyId }: { canWrite: boolean; children?: ReactNode; emailMatchContext?: EmailMatchContext; initialMessageId?: string; initialReplyId?: string }): React.JSX.Element {
  const emailOrganizationId = emailMatchContext?.organizationId, emailUserId = emailMatchContext?.userId
  const [writeAllowed, setWriteAllowed] = useState(canWrite)
  const [revoked, setRevoked] = useState(false)
  const revokedRef = useRef(false)
  const [status, setStatus] = useState<FollowUpStatus>('PENDING')
  const [items, setItems] = useState<FollowUpItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [navigation, setNavigation] = useState<Navigation | null>(null)
  const [focusedReplyId, setFocusedReplyId] = useState(initialReplyId)
  const [focusedError, setFocusedError] = useState('')
  const readEpoch = useRef(0)
  const openDrafts = useRef(new Set<string>())
  const trackComposer = useCallback((id: string, open: boolean) => {
    if (open) { readEpoch.current++; openDrafts.current.add(id) }
    else openDrafts.current.delete(id)
  }, [])

  const invalidate = useCallback((cause?: unknown, id?: string) => {
    readEpoch.current++
    if (cause instanceof FollowUpClientError && cause.status === 404 && id) {
      setItems(previous => previous.filter(item => item.id !== id))
      openDrafts.current.delete(id)
      setFocusedError('This follow-up is no longer available.')
      return
    }
    revokedRef.current = true
    setRevoked(true)
    setWriteAllowed(false)
    setItems([])
    openDrafts.current.clear()
    setNavigation(null)
    setFocusedError('')
    setError('Access changed. Reload before continuing.')
  }, [])

  function navigate(target: Navigation, discard = false): boolean {
    if (target === status) return true
    if (!discard && openDrafts.current.size > 0) { setNavigation(target); return false }
    setNavigation(null)
    if (typeof target === 'object') { setFocusedReplyId(target.replyId); setStatus('PENDING'); setRevision(value => value + 1) }
    else if (target === 'refresh') setRevision(value => value + 1)
    else setStatus(target)
    return true
  }

  useEffect(() => {
    if (initialReplyId !== focusedReplyId) navigate({ replyId: initialReplyId })
    // Incoming review links use the same open-draft confirmation as refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialReplyId])
  useEffect(() => {
    let current = true
    if (revokedRef.current) return
    const epoch = ++readEpoch.current
    const emailContext = emailOrganizationId && emailUserId ? { organizationId: emailOrganizationId, userId: emailUserId } : undefined
    setLoading(true)
    setError(null)
    setItems([])
    setFocusedError('')
    const focused = focusedReplyId && emailContext && status === 'PENDING' ? fetch(`/api/email-notifications/follow-up/${focusedReplyId}`, { cache: 'no-store', headers: emailNotificationHeaders(emailContext) })
      .then(response => emailNotificationData(response, emailContext))
      .then(value => { const item = focusedEmailReply.parse(value); if (item.id !== focusedReplyId) throw new Error('The requested email reply changed. Refresh to try again.'); return item })
      .catch(cause => { if (cause instanceof EmailNotificationError && ([401, 403].includes(cause.status) || /CONTEXT|WORKSPACE/.test(cause.code))) throw cause; if (current) setFocusedError(cause instanceof Error ? cause.message : 'Requested reply is no longer available.'); return null }) : Promise.resolve(null)
    Promise.all([fetch(`/api/follow-ups?status=${status}`, { cache: 'no-store', headers: emailContext ? followUpHeaders(emailContext) : {} }).then(response => followUpData<FollowUpItem[]>(response, emailContext)), focused])
      .then(([result, item]) => { if (current && epoch === readEpoch.current && !revokedRef.current) { const rows = result.data; setWriteAllowed(result.canWrite ?? canWrite); setItems(item ? [item, ...rows.filter(row => row.id !== item.id)] : focusedReplyId && emailContext ? rows.filter(row => row.id !== focusedReplyId) : rows) } })
      .catch((cause) => { if (current) { if (followUpAccessLost(cause) || cause instanceof EmailNotificationError && ([401, 403].includes(cause.status) || /CONTEXT|WORKSPACE/.test(cause.code))) invalidate(cause); else setError(cause instanceof Error ? cause.message : 'Unable to load follow-ups.') } })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [status, revision, focusedReplyId, emailOrganizationId, emailUserId, canWrite, invalidate])

  useEffect(() => {
    if (!emailOrganizationId || !emailUserId || revoked) return
    let current = true, checking = false
    const context = { organizationId: emailOrganizationId, userId: emailUserId }
    async function revalidate(): Promise<void> {
      if (!current || checking || revokedRef.current || document.visibilityState !== 'visible') return
      checking = true
      const epoch = readEpoch.current
      const query = new URLSearchParams({ status })
      const retained = new Set([...openDrafts.current, ...(focusedReplyId ? [focusedReplyId] : [])])
      for (const id of retained) query.append('retain', id)
      try {
        const result = await followUpData<FollowUpItem[]>(await fetch(`/api/follow-ups?${query}`, { cache: 'no-store', headers: followUpHeaders(context) }), context)
        if (current && epoch === readEpoch.current && !revokedRef.current) { setItems(result.data); setWriteAllowed(result.canWrite ?? false) }
      } catch (cause) {
        if (current && epoch === readEpoch.current && followUpAccessLost(cause)) invalidate(cause)
      } finally { checking = false }
    }
    const timer = window.setInterval(() => void revalidate(), 60000)
    const focus = () => { void revalidate() }
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', focus)
    return () => { current = false; window.clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus) }
  }, [emailOrganizationId, emailUserId, status, focusedReplyId, revoked, invalidate])

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow text-muted-foreground">Your next steps</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Follow-up inbox</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Review incoming replies and callback requests. Approve a task, or open a draft to review and send.</p>
        </div>
        <Button type="button" variant="outline" onClick={() => navigate('refresh')} disabled={loading}>
          <RotateCw className="mr-2 size-4" aria-hidden="true" />Refresh
        </Button>
      </div>
      {children}
      {emailMatchContext && !revoked && <EmailMatchInbox context={emailMatchContext} initialMessageId={initialMessageId} canWrite={writeAllowed} onResolved={() => navigate('refresh')} />}
      {navigation && <section role="group" aria-label="Open draft confirmation" className="rounded-lg border bg-card p-4"><p className="text-sm">You have an open email draft. Continuing will discard its unsent edits.</p><div className="mt-3 flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => setNavigation(null)}>Keep editing</Button><Button type="button" onClick={() => navigate(navigation, true)}>{typeof navigation === 'object' ? 'Discard and open reply' : navigation === 'refresh' ? 'Discard and refresh' : 'Discard and change tab'}</Button></div></section>}
      {focusedError && <p role="alert" className="text-sm text-destructive">{focusedError}</p>}
      <div role="tablist" aria-label="Follow-up status" className="flex w-fit max-w-full gap-1 rounded-lg border bg-muted/40 p-1">
        {tabs.map((tab) => <button key={tab.value} id={`follow-ups-${tab.value}`} type="button" role="tab" aria-selected={status === tab.value} aria-controls="follow-up-panel" tabIndex={status === tab.value ? 0 : -1} onKeyDown={(event) => {
          const index = tabs.findIndex((value) => value.value === tab.value)
          const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1
          if (next < 0) return
          event.preventDefault()
          if (navigate(tabs[next].value)) document.getElementById(`follow-ups-${tabs[next].value}`)?.focus()
        }} onClick={() => navigate(tab.value)} className={cn('rounded-md px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring', status === tab.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{tab.label}</button>)}
      </div>
      {!writeAllowed && <p className="text-sm text-muted-foreground">You have read-only access. Ask a team member with lead editing permission to review these follow-ups.</p>}
      <section id="follow-up-panel" role="tabpanel" aria-labelledby={`follow-ups-${status}`} aria-busy={loading} className="min-w-0">
        {loading ? <p role="status" className="py-12 text-center text-sm text-muted-foreground">Loading follow-ups…</p> : error ? <div className="rounded-lg border bg-card p-6"><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="outline" className="mt-3" onClick={() => navigate('refresh')}>Try again</Button></div> : items.length === 0 ? <div className="flex flex-col items-center rounded-xl border border-dashed bg-card px-5 py-14 text-center"><Inbox className="mb-3 size-7 text-muted-foreground" aria-hidden="true" /><h2 className="font-medium">No {status.toLowerCase()} follow-ups</h2><p className="mt-1 max-w-md text-sm text-muted-foreground">{status === 'PENDING' ? 'New replies from synced sales conversations and confirmed receptionist callbacks will appear here.' : 'Reviewed follow-ups will appear here.'}</p></div> : <div className="grid min-w-0 gap-4">{items.map((item) => <FollowUpCard key={item.id} item={item} canWrite={writeAllowed} context={emailMatchContext} onAccessLost={invalidate} onComposerChange={trackComposer} />)}</div>}
      </section>
      <p className="text-xs text-muted-foreground">Showing up to 100 recent items assigned to you, plus open drafts and a focused reply. Email sources are previews, and draft text is a starting template. Approving a task does not send an email.</p>
    </div>
  )
}

function FollowUpCard({ item, canWrite, context, onAccessLost, onComposerChange }: { item: FollowUpItem; canWrite: boolean; context?: FollowUpContext; onAccessLost: (cause?: unknown, id?: string) => void; onComposerChange: (id: string, open: boolean) => void }): React.JSX.Element {
  const [title, setTitle] = useState(item.title)
  const [description, setDescription] = useState(item.description)
  const [dueDate, setDueDate] = useState('')
  const [result, setResult] = useState(item)
  const [busy, setBusy] = useState(false)
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
    setResult(current => ({ ...current, status: item.status, taskId: item.taskId }))
    if (item.status === 'DISMISSED') { requestVersion.current++; setCompose(false); setConfirmReplace(false) }
  }, [item.status, item.taskId])
  const generated = Boolean(result.draftVersion && result.draftContext)
  const recipient = generated ? result.draftContext!.recipientEmail : item.lead.email
  const canGenerate = canWrite && result.sourceType === 'EMAIL' && result.status !== 'DISMISSED'

  async function generateDraft(replace = false): Promise<void> {
    if (generating || busy || !canGenerate) return
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
  const fullName = `${item.lead.firstName} ${item.lead.lastName}`.trim() || 'Lead'
  const Icon = item.sourceType === 'CALL' ? Phone : Mail

  async function review(action: 'approve' | 'dismiss'): Promise<void> {
    if (busy || !editable) return
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
        <label className="grid gap-1.5 text-sm font-medium">Task title<input className={fieldClass} value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} disabled={busy} required /></label>
        <label className="grid gap-1.5 text-sm font-medium">Due date<input className={fieldClass} type="date" aria-label="Due date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} disabled={busy} /><span className="text-xs font-normal text-muted-foreground">Optional · UTC date</span></label>
        <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">Task description<textarea className={fieldClass} rows={3} value={description} maxLength={10000} onChange={(event) => setDescription(event.target.value)} disabled={busy} /></label>
      </div> : <div className="mt-4"><h3 className="break-words text-sm font-medium">{result.title}</h3><p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{result.description}</p>{result.taskId && pending && <p className="mt-2 text-xs text-muted-foreground">A callback task already exists. Marking this reviewed keeps the existing task.</p>}</div>}
      {canGenerate && <div className="mt-4 grid gap-2"><label className="grid gap-1.5 text-sm font-medium">Draft instructions<textarea className={fieldClass} rows={2} maxLength={2000} value={instructions} onChange={event => setInstructions(event.target.value)} disabled={generating || busy} placeholder="Optional: ask about their timeline, or keep the reply brief" /></label><p className="text-xs text-muted-foreground">Generate from the full email conversation. Attachments are excluded.</p><Button type="button" variant="outline" className="w-fit" disabled={generating || busy} onClick={() => void generateDraft()}>{generating ? 'Generating draft…' : generated ? 'Regenerate contextual draft' : 'Generate contextual draft'}</Button></div>}
      {confirmReplace && <div className="mt-3 rounded-lg border p-3" role="group" aria-label="Replace open draft confirmation"><p className="text-sm">A draft is open. Regenerating will replace it and discard its edits after generation succeeds.</p><div className="mt-2 flex flex-wrap gap-2"><Button type="button" onClick={() => void generateDraft(true)}>Replace open draft</Button><Button type="button" variant="outline" onClick={() => setConfirmReplace(false)}>Keep editing</Button></div></div>}
      {generated && result.draftContext && <div className="mt-3 break-words text-xs text-muted-foreground"><p>Generated from {result.draftContext.messageCount} messages · {result.draftContext.provider === 'gmail' ? 'Gmail' : 'Microsoft 365'} {result.draftContext.mailboxEmail ? `mailbox ${result.draftContext.mailboxEmail}` : 'mailbox'}</p><p>Reply to {result.draftContext.recipientEmail} in the source conversation</p>{result.draftGeneratedAt && <p>Generated <time dateTime={result.draftGeneratedAt}>{new Date(result.draftGeneratedAt).toLocaleString()}</time></p>}</div>}
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="mt-3 flex items-center gap-1.5 text-sm text-brand"><Check className="size-4" aria-hidden="true" />{notice}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {editable && <><Button type="button" disabled={busy || (!result.taskId && !title.trim())} onClick={() => void review('approve')}>{busy ? 'Saving…' : result.taskId ? 'Mark reviewed' : 'Approve task'}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => void review('dismiss')}>Dismiss</Button></>}
        {result.taskId && <Link className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`/tasks/${result.taskId}`}>Open task</Link>}
        {canWrite && result.status !== 'DISMISSED' && recipient && result.draftBody && <Button type="button" variant="outline" disabled={busy || generating} onClick={() => setCompose((value) => !value)}>{compose ? 'Close draft' : 'Review email draft'}</Button>}
      </div>
      {compose && canWrite && result.status !== 'DISMISSED' && result.draftBody && recipient && <div className="mt-5 min-w-0 border-t pt-5"><p className="mb-3 text-xs text-muted-foreground">{generated ? 'Review and edit this contextual reply before sending. The recipient, mailbox and conversation are bound to this draft.' : 'Review and edit this template before sending. This starts a new email; check the subject and recipient.'}</p><EmailCompose key={result.draftVersion ?? 'template'} leadId={item.lead.id} leadEmail={recipient} leadName={fullName} defaultSubject={result.draftSubject ?? ''} defaultBody={draftHtml(result.draftBody)} followUpId={item.id} followUpContext={context} onAccessLost={() => onAccessLost(undefined, item.id)} {...(generated ? { draftVersion: result.draftVersion!, replyToThreadId: result.draftContext!.threadId, replySubject: result.draftSubject ?? '' } : {})} onSent={() => { setCompose(false); setNotice('Email sent. Task review is tracked separately.') }} /></div>}
    </article>
  )
}
