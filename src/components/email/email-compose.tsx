'use client'
import {useSendResultRecovery,SendResultRecovery} from './send-result-recovery'

import { useEffect, useId, useRef, useState, useTransition } from 'react'
import {
  Loader2,
  Mail,
  MailPlus,
  Paperclip,
  Send,
  X,
} from 'lucide-react'

import { ComposeDraftRecovery, useComposeDraftRecovery } from './compose-draft-recovery'
import { Button } from '@/components/ui/button'
import { RichTextEditor } from '@/components/email/rich-text-editor'
import { EmailGenerator } from '@/components/ai/email-generator'
import { useWorkspaceIdentity } from '@/components/layout/workspace-identity'
import { followUpHeaders, type FollowUpContext } from '@/lib/follow-up-access'
import { followUpData, followUpAccessLost } from '@/lib/follow-up-client'
import { cn } from '@/lib/utils'

/**
 * Latest-thread shape consumed by `EmailCompose` so the UI can offer
 * "reply on the existing thread" by default, falling back to "new
 * thread" only when the user explicitly opts out.
 */
export interface LatestEmailThread {
  threadId: string
  /** Most recent subject on the thread (rendered as "Re: …"). */
  subject: string
  /** ISO timestamp of the latest message — drives the helper hint. */
  lastSentAt?: string
}

export interface EmailComposeProps {
  /** The lead to send the email to. */
  leadId: string
  /** Lead's email address — shown as the "To" field. */
  leadEmail: string | null
  /** Lead's display name for the "To" field. */
  leadName: string
  /** Optional pre-filled subject (e.g. from AI generation). */
  defaultSubject?: string
  /** Optional pre-filled body (e.g. from AI generation). */
  defaultBody?: string
  /** Binds an explicitly reviewed conversation draft to its server-side context. */
  followUpId?: string
  draftVersion?: string
  followUpContext?: FollowUpContext
  sendResultRecovery?: boolean
  savedDraftRecovery?: boolean
  recoveryPaused?: boolean
  onAccessLost?: () => void
  /**
   * When provided, the email is sent as a reply on this Gmail thread.
   * The subject is locked and prefixed with "Re:" automatically. Used
   * when callers want to force a specific reply target (e.g. clicking
   * "Reply" inside an `EmailThread`).
   */
  replyToThreadId?: string
  /** Subject of the latest message on the thread, used to seed "Re:" subject. */
  replySubject?: string
  /**
   * Latest thread that exists for this lead. When present and no
   * explicit `replyToThreadId` has been supplied, the form defaults
   * to replying on this thread; the user can flip a toggle to start
   * a new conversation. When absent, the form starts in new-thread
   * mode (the original behaviour).
   */
  latestThread?: LatestEmailThread
  /** Called after a successful send. */
  onSent?: (result: {
    messageId: string
    threadId: string
    attachmentCount: number
  }) => void
  /** Optional extra class for the root element. */
  className?: string
  /**
   * When false, renders a "Compose" button that expands into the form.
   * Defaults to true so the form is rendered inline (matches the
   * previous Next port behaviour).
   */
  alwaysOpen?: boolean
}

interface UploadedAttachment {
  file: File
  status: 'pending' | 'uploading' | 'uploaded' | 'failed'
  error?: string
}

const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024 // 25 MB — matches /api/upload

/**
 * Email compose form.
 *
 * Supports two modes:
 *   - **New email** — user enters subject + body, optionally attaches
 *     files, and posts to `/api/email/send`. Files are uploaded via
 *     `/api/upload` after the send succeeds and become attachments on the
 *     activity that the send service creates.
 *   - **Reply in thread** — when `replyToThreadId` is set, the subject is
 *     pre-filled with `Re: <thread subject>` and locked. The send
 *     endpoint receives `threadId` so Gmail stitches the message into the
 *     existing conversation.
 *
 * The AI email generator is embedded so users can drop in an
 * AI-generated draft directly. Personalization tag insertion happens
 * inside the rich text editor itself (toolbar button, autocomplete on
 * `{{`, preview pane).
 *
 * Validates: Requirements 7.1, 7.2, 7.3
 */
export function EmailCompose({
  leadId,
  leadEmail,
  leadName,
  defaultSubject = '',
  defaultBody = '',
  followUpId,
  draftVersion,
  followUpContext,
  savedDraftRecovery = false,
  sendResultRecovery = false,
  recoveryPaused = false,
  onAccessLost,
  replyToThreadId,
  replySubject,
  latestThread,
  onSent,
  className,
  alwaysOpen = true,
}: EmailComposeProps): React.JSX.Element {
  // When the caller supplies an explicit `replyToThreadId` (e.g. from
  // the EmailThread "Reply" button), the form is locked to that
  // thread. Otherwise we default to the lead's most recent thread —
  // user can flip "Start new thread" to override. This mirrors how
  // mail clients usually keep conversations together by default.
  const providerIdentity = useWorkspaceIdentity()
  const identity = followUpContext ?? providerIdentity
  const capturedIdentity = useRef(identity)
  const [revoked, setRevoked] = useState(false)
  const valid = useRef(true)
  const subjectId = useId()
  const initialThreadMode: 'reply' | 'new' = replyToThreadId
    ? 'reply'
    : latestThread
      ? 'reply'
      : 'new'
  const [threadMode, setThreadMode] = useState<'reply' | 'new'>(initialThreadMode)

  const activeThreadId = replyToThreadId
    ?? (threadMode === 'reply' ? latestThread?.threadId : undefined)
  const activeReplySubject = replyToThreadId
    ? replySubject
    : threadMode === 'reply'
      ? latestThread?.subject
      : undefined

  const isReply = Boolean(activeThreadId)
  const replyLocked = Boolean(replyToThreadId)

  const initialSubject = isReply
    ? prefixReplySubject(defaultSubject || activeReplySubject || '')
    : defaultSubject

  const [open, setOpen] = useState(alwaysOpen)
  const [subject, setSubject] = useState(initialSubject)
  const [body, setBody] = useState(defaultBody)
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  // Re-keys the editor when we apply an AI draft so its internal state
  // resets to the new defaultValue (TipTap doesn't react to prop changes).
  const [editorKey, setEditorKey] = useState(0)
  const [testStatus, setTestStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'sending' }
    | { kind: 'sent'; recipient: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  function revokeAccess(): void {
    valid.current = false
    setRevoked(true)
    setSubject('')
    setBody('')
    setAttachments([])
    setError(null)
    setSuccess(null)
    onAccessLost?.()
  }
  const identityChanged = identity?.organizationId !== capturedIdentity.current?.organizationId || identity?.userId !== capturedIdentity.current?.userId
  useEffect(() => {
    if (identityChanged) revokeAccess()
    // Scalar identity changes invalidate the captured compose session permanently.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityChanged])
  useEffect(() => { valid.current = true; return () => { valid.current = false } }, [])

  const recovery = useComposeDraftRecovery({ enabled: savedDraftRecovery, id: followUpId, context: identity, binding: { leadId, recipientEmail: leadEmail ?? '', draftVersion: draftVersion ?? null, threadId: activeThreadId ?? null }, subject, body, paused: recoveryPaused || revoked || identityChanged || isPending || testStatus.kind === 'sending', onAccessLost: revokeAccess, onRestore: content => { setSubject(content.subject); setBody(content.body); setEditorKey(value => value + 1) } })

  const sendRecovery = useSendResultRecovery({enabled:sendResultRecovery,id:followUpId,context:identity,paused:recoveryPaused||revoked||identityChanged,onAccessLost:revokeAccess})

  /**
   * Sends a preview of the current subject + body to the connected
   * Gmail account itself with sample personalization values. Lets the
   * user inspect the rendered email — including formatting and tag
   * substitution — before sending it to the actual lead.
   */
  async function sendPreview(): Promise<void> {
    if (!subject.trim() || !body.trim()) {
      setTestStatus({
        kind: 'error',
        message: 'Subject and body are required to send a test.',
      })
      return
    }
    setTestStatus({ kind: 'sending' })
    try {
      const res = await fetch('/api/email/test', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setTestStatus({
          kind: 'error',
          message: data.error?.message ?? `Failed to send test (${res.status})`,
        })
        return
      }
      const data = (await res.json()) as { data: { recipient: string } }
      setTestStatus({ kind: 'sent', recipient: data.data.recipient })
    } catch (err) {
      setTestStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to send test.',
      })
    }
  }

  const fileInputRef = useRef<HTMLInputElement>(null)

  // When the user toggles thread mode, re-prefix the subject with "Re:"
  // (or strip it) so the field reflects the actual outgoing subject.
  // We don't touch user-typed customizations beyond the prefix.
  useEffect(() => {
    if (followUpId && replyLocked) return
    setSubject((current) => {
      if (isReply) {
        return prefixReplySubject(
          stripReplyPrefix(current) || activeReplySubject || '',
        )
      }
      return stripReplyPrefix(current)
    })
    // Intentionally only respond to thread-mode flips; the user's own
    // edits should not bounce through this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadMode, replyLocked])

  function appendFiles(files: readonly File[]): void {
    const accepted: UploadedAttachment[] = []
    const rejected: string[] = []
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_SIZE) {
        rejected.push(`${file.name} (over 25 MB)`)
        continue
      }
      accepted.push({ file, status: 'pending' })
    }
    if (accepted.length > 0) {
      setAttachments((prev) => [...prev, ...accepted])
    }
    if (rejected.length > 0) {
      setError(`Skipped: ${rejected.join(', ')}`)
    }
  }

  function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(event.target.files ?? [])
    appendFiles(files)
    event.target.value = ''
  }

  function removeAttachment(index: number): void {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!valid.current || revoked || identityChanged || recovery.blocked || sendRecovery.blocked) return
    setError(null)
    setSuccess(null)

    if (!leadEmail) {
      setError('This lead does not have an email address.')
      return
    }
    if (!subject.trim()) {
      setError('Subject is required.')
      return
    }
    if (!body.trim()) {
      setError('Email body is required.')
      return
    }

    let operationId: string | undefined
    try { operationId = sendRecovery.start() } catch { return }
    recovery.noteSend({ subject: subject.trim(), body: body.trim() })
    startTransition(async () => {
      try {
        // When attachments are present we POST `multipart/form-data`
        // so the server can stitch them into the Gmail message itself.
        // Without attachments we keep the simple JSON path.
        const hasAttachments = attachments.length > 0

        let res: Response
        if (hasAttachments) {
          // Mark all attachments as uploading so the user sees feedback.
          setAttachments((prev) =>
            prev.map((a) => ({ ...a, status: 'uploading', error: undefined })),
          )
          const formData = new FormData()
          formData.append(
            'payload',
            JSON.stringify({
              leadId,
              ...(operationId ? {operationId} : {}),
              subject: subject.trim(),
              body: body.trim(),
              ...(activeThreadId ? { threadId: activeThreadId } : {}),
              ...(followUpId ? { followUpId, ...(draftVersion ? { draftVersion } : {}) } : {}),
            }),
          )
          for (const att of attachments) {
            formData.append('attachments', att.file, att.file.name)
          }
          res = await fetch('/api/email/send', {
            method: 'POST',
            credentials: 'same-origin',
            headers: capturedIdentity.current ? followUpHeaders(capturedIdentity.current) : {},
            body: formData,
          })
        } else {
          res = await fetch('/api/email/send', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              ...(capturedIdentity.current ? followUpHeaders(capturedIdentity.current) : {}),
            },
            credentials: 'same-origin',
            body: JSON.stringify({
              leadId,
              ...(operationId ? {operationId} : {}),
              subject: subject.trim(),
              body: body.trim(),
              ...(activeThreadId ? { threadId: activeThreadId } : {}),
              ...(followUpId ? { followUpId, ...(draftVersion ? { draftVersion } : {}) } : {}),
            }),
          })
        }

        if (!valid.current) return
        const responseBody = await followUpData<{ messageId: string; threadId: string; attachmentCount: number }>(res, capturedIdentity.current)
        if (!valid.current) return

        sendRecovery.confirmed(responseBody.sendResult,responseBody.data,operationId)
        if (hasAttachments) {
          setAttachments((prev) =>
            prev.map((a) => ({ ...a, status: 'uploaded' })),
          )
        }

        setSuccess(
          attachments.length > 0
            ? `Email sent with ${attachments.length} attachment${attachments.length === 1 ? '' : 's'}.`
            : 'Email sent successfully.',
        )
        recovery.clearAfterSend()
        onSent?.(responseBody.data)
      } catch (err) {
        if (!valid.current) return
        sendRecovery.failed()
        if (followUpAccessLost(err)) { revokeAccess(); return }
        setAttachments(previous => previous.map(attachment => ({ ...attachment, status: 'failed' })))
        setError(err instanceof Error ? err.message : 'Failed to send email.')
      }
    })
  }

  if (revoked || identityChanged) return <p role="alert">Access changed. Reload before continuing.</p>

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <Mail className="size-3.5" aria-hidden="true" />
        <span>{isReply ? 'Reply' : 'Send email'}</span>
      </Button>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn('flex flex-col gap-3 rounded-lg border bg-card p-[18px]', className)}
      aria-busy={isPending || undefined}
      aria-label={isReply ? 'Reply email' : 'Compose email'}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {isReply ? 'Reply in thread' : 'Compose email'}
        </h3>
        {!alwaysOpen && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close compose"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Thread-mode toggle — only shown when the lead already has a
          recent thread and the caller hasn't locked the form to a
          specific reply target. Lets the user opt out of "reply on
          existing thread" when they want to start a fresh subject. */}
      {latestThread && !replyLocked && (
        <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs">
          <MailPlus
            className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <div className="flex-1">
            {threadMode === 'reply' ? (
              <>
                <p className="font-medium text-foreground">
                  Replying on existing thread
                </p>
                <p className="mt-0.5 truncate text-muted-foreground">
                  {latestThread.subject}
                </p>
              </>
            ) : (
              <p className="font-medium text-foreground">
                Starting a new thread
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() =>
              setThreadMode((m) => (m === 'reply' ? 'new' : 'reply'))
            }
            className="shrink-0 rounded-[10px] border bg-card px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted"
            disabled={isPending}
          >
            {threadMode === 'reply'
              ? 'Start new thread'
              : 'Reply on existing thread'}
          </button>
        </div>
      )}

      {/* To field (read-only) */}
      <div className="flex items-center gap-2 text-sm">
        <Mail className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium text-muted-foreground">To:</span>
        <span className="text-foreground">
          {leadName}
          {leadEmail ? (
            <span className="ml-1 text-muted-foreground">&lt;{leadEmail}&gt;</span>
          ) : (
            <span className="ml-1 text-danger-foreground">(no email)</span>
          )}
        </span>
      </div>

      {/* Subject */}
      <div>
        <label
          htmlFor={subjectId}
          className="block text-xs font-medium text-foreground mb-1"
        >
          Subject
        </label>
        <input
          id={subjectId}
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Email subject…"
          className={cn(inputClasses, isReply && 'opacity-70')}
          disabled={isPending || isReply}
        />
        {isReply && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Subject is locked when replying in a thread.
          </p>
        )}
      </div>

      <ComposeDraftRecovery state={recovery} />

      {/* Body */}
      <div>
        <span className="mb-1 block text-xs font-medium text-foreground">
          Body
        </span>
        <RichTextEditor
          key={editorKey}
          defaultValue={body}
          onChange={(html) => setBody(html)}
          onFilesDropped={appendFiles}
          placeholder="Write your email…"
          minHeight="180px"
        />
      </div>

      {/* AI helper — pastes draft into subject/body */}
      {!followUpId && <EmailGenerator
        leadId={leadId}
        leadName={leadName}
        onUseDraft={({ subject: draftSubject, body: draftBody }) => {
          if (!isReply) setSubject(draftSubject)
          setBody(draftBody)
          setEditorKey((k) => k + 1)
        }}
      />}

      {/* Attachments */}
      <div className="flex flex-col gap-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={isPending}
          >
            <Paperclip className="size-3.5" aria-hidden="true" />
            <span>Attach file</span>
          </Button>
          <span className="text-[11px] text-muted-foreground">
            Up to 25 MB each. Drag &amp; drop or paste into the body to attach.
          </span>
        </div>
        {attachments.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {attachments.map((att, i) => (
              <li
                key={`${att.file.name}-${i}`}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border bg-card px-2 py-0.5 text-xs',
                  att.status === 'failed' && 'border-danger/40 text-danger-foreground',
                  att.status === 'uploaded' && 'border-brand/40 text-brand-emphasis',
                )}
                title={att.error}
              >
                <Paperclip className="size-3 text-muted-foreground" aria-hidden="true" />
                <span className="max-w-[160px] truncate">{att.file.name}</span>
                <span className="text-muted-foreground">
                  {formatFileSize(att.file.size)}
                </span>
                {att.status === 'uploading' && (
                  <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                )}
                {att.status === 'failed' && (
                  <span className="text-[10px] uppercase tracking-wide">failed</span>
                )}
                <button
                  type="button"
                  onClick={() => removeAttachment(i)}
                  className="text-muted-foreground hover:text-danger-foreground"
                  aria-label={`Remove ${att.file.name}`}
                  disabled={isPending}
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <SendResultRecovery state={sendRecovery} />
      {error ? (
        <p role="alert" className="text-sm text-danger-foreground">
          {error}
        </p>
      ) : null}

      {success ? (
        <div
          role="status"
          className="rounded-lg border border-brand/30 bg-brand-subtle px-3 py-2 text-sm text-brand-emphasis"
        >
          {success}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {testStatus.kind === 'sent' ? (
          <span className="mr-auto text-xs text-brand-emphasis">
            Test sent to {testStatus.recipient}
          </span>
        ) : testStatus.kind === 'error' ? (
          <span role="alert" className="mr-auto text-xs text-danger-foreground">
            {testStatus.message}
          </span>
        ) : null}
        {!followUpId && <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={sendPreview}
          disabled={
            isPending
            || testStatus.kind === 'sending'
            || !subject.trim()
            || !body.trim()
          }
          title="Send a preview of this email to your own Gmail with sample personalization"
        >
          {testStatus.kind === 'sending' ? (
            <>
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              <span>Sending test…</span>
            </>
          ) : (
            <span>Send test email</span>
          )}
        </Button>}
        {!alwaysOpen && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
        )}
        <Button type="submit" size="sm" disabled={isPending || !leadEmail || recovery.blocked || sendRecovery.blocked}>
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              <span>Sending…</span>
            </>
          ) : (
            <>
              <Send className="size-3.5" aria-hidden="true" />
              <span>{isReply ? 'Send reply' : 'Send email'}</span>
            </>
          )}
        </Button>
      </div>
    </form>
  )
}

const inputClasses =
  'flex h-10 w-full rounded-[10px] border border-input bg-card px-3 py-1 text-sm text-foreground shadow-sm transition-[color,box-shadow,border-color] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand/15 disabled:cursor-not-allowed disabled:opacity-50'

function prefixReplySubject(subject: string): string {
  const trimmed = subject.trim()
  if (!trimmed) return 'Re:'
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`
}

/**
 * Strips a leading `Re:` prefix from a subject. Used when toggling
 * away from reply mode so the subject doesn't keep accumulating
 * prefixes if the user flips back and forth.
 */
function stripReplyPrefix(subject: string): string {
  return subject.replace(/^\s*re:\s*/i, '').trim()
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
