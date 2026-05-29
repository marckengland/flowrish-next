'use client'

import { useRef, useState, useTransition } from 'react'
import {
  Loader2,
  Mail,
  Paperclip,
  Send,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { RichTextEditor } from '@/components/email/rich-text-editor'
import { EmailGenerator } from '@/components/ai/email-generator'
import { cn } from '@/lib/utils'

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
  /**
   * When provided, the email is sent as a reply on this Gmail thread.
   * The subject is locked and prefixed with "Re:" automatically.
   */
  replyToThreadId?: string
  /** Subject of the latest message on the thread, used to seed "Re:" subject. */
  replySubject?: string
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
  replyToThreadId,
  replySubject,
  onSent,
  className,
  alwaysOpen = true,
}: EmailComposeProps): React.JSX.Element {
  const isReply = Boolean(replyToThreadId)
  const initialSubject = isReply
    ? prefixReplySubject(defaultSubject || replySubject || '')
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

  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(event.target.files ?? [])
    const accepted: UploadedAttachment[] = []
    const rejected: string[] = []
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_SIZE) {
        rejected.push(`${file.name} (over 25 MB)`)
        continue
      }
      accepted.push({ file, status: 'pending' })
    }
    setAttachments((prev) => [...prev, ...accepted])
    if (rejected.length > 0) {
      setError(`Skipped: ${rejected.join(', ')}`)
    }
    event.target.value = ''
  }

  function removeAttachment(index: number): void {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
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
              subject: subject.trim(),
              body: body.trim(),
              ...(replyToThreadId ? { threadId: replyToThreadId } : {}),
            }),
          )
          for (const att of attachments) {
            formData.append('attachments', att.file, att.file.name)
          }
          res = await fetch('/api/email/send', {
            method: 'POST',
            credentials: 'same-origin',
            body: formData,
          })
        } else {
          res = await fetch('/api/email/send', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            credentials: 'same-origin',
            body: JSON.stringify({
              leadId,
              subject: subject.trim(),
              body: body.trim(),
              ...(replyToThreadId ? { threadId: replyToThreadId } : {}),
            }),
          })
        }

        if (!res.ok) {
          let message = `Failed to send email (${res.status})`
          try {
            const responseBody = (await res.json()) as { error?: { message?: string } }
            if (responseBody.error?.message) message = responseBody.error.message
          } catch {
            // ignore parse failure
          }
          if (hasAttachments) {
            setAttachments((prev) =>
              prev.map((a) => ({ ...a, status: 'failed', error: message })),
            )
          }
          setError(message)
          return
        }

        const responseBody = (await res.json()) as {
          data: { messageId: string; threadId: string; attachmentCount: number }
        }

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
        onSent?.(responseBody.data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to send email.')
      }
    })
  }

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
      className={cn('flex flex-col gap-3 rounded-md border bg-card p-4', className)}
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

      {/* To field (read-only) */}
      <div className="flex items-center gap-2 text-sm">
        <Mail className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium text-muted-foreground">To:</span>
        <span className="text-foreground">
          {leadName}
          {leadEmail ? (
            <span className="ml-1 text-muted-foreground">&lt;{leadEmail}&gt;</span>
          ) : (
            <span className="ml-1 text-destructive">(no email)</span>
          )}
        </span>
      </div>

      {/* Subject */}
      <div>
        <label
          htmlFor="email-subject"
          className="block text-xs font-medium text-foreground mb-1"
        >
          Subject
        </label>
        <input
          id="email-subject"
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

      {/* Body */}
      <div>
        <span className="mb-1 block text-xs font-medium text-foreground">
          Body
        </span>
        <RichTextEditor
          key={editorKey}
          defaultValue={defaultBody}
          onChange={(html) => setBody(html)}
          placeholder="Write your email…"
          minHeight="180px"
        />
      </div>

      {/* AI helper — pastes draft into subject/body */}
      <EmailGenerator
        leadId={leadId}
        leadName={leadName}
        onUseDraft={({ subject: draftSubject, body: draftBody }) => {
          if (!isReply) setSubject(draftSubject)
          setBody(draftBody)
          setEditorKey((k) => k + 1)
        }}
      />

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
            Up to 25 MB each. Sent as attachments inside the email.
          </span>
        </div>
        {attachments.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {attachments.map((att, i) => (
              <li
                key={`${att.file.name}-${i}`}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border bg-background px-2 py-0.5 text-xs',
                  att.status === 'failed' && 'border-destructive/40 text-destructive',
                  att.status === 'uploaded' && 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300',
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
                  className="text-muted-foreground hover:text-destructive"
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

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {success ? (
        <div
          role="status"
          className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300"
        >
          {success}
        </div>
      ) : null}

      <div className="flex justify-end gap-2">
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
        <Button type="submit" size="sm" disabled={isPending || !leadEmail}>
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
  'flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

function prefixReplySubject(subject: string): string {
  const trimmed = subject.trim()
  if (!trimmed) return 'Re:'
  return /^re:\s/i.test(trimmed) ? trimmed : `Re: ${trimmed}`
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
