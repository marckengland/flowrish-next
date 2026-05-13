'use client'

import { useRef, useState, useTransition } from 'react'
import { Loader2, Mail, Send, Tag } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Supported personalization tags that can be inserted into the email
 * subject or body. These are replaced server-side with lead data before
 * sending (Requirement 7.2).
 */
const PERSONALIZATION_TAGS = [
  { tag: '{{FirstName}}', label: 'First Name' },
  { tag: '{{LastName}}', label: 'Last Name' },
  { tag: '{{FullName}}', label: 'Full Name' },
  { tag: '{{CompanyName}}', label: 'Company' },
  { tag: '{{Title}}', label: 'Title' },
] as const

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
  /** Called after a successful send. */
  onSent?: (result: { messageId: string; threadId: string }) => void
  /** Optional extra class for the root element. */
  className?: string
}

/**
 * Email compose form with personalization tag insertion.
 *
 * Provides a subject + body editor with a toolbar for inserting
 * personalization tags at the cursor position. Sends via
 * `POST /api/email/send` which handles tag replacement, HTML wrapping,
 * and Gmail API delivery.
 *
 * Validates: Requirements 7.1, 7.2, 7.3
 */
export function EmailCompose({
  leadId,
  leadEmail,
  leadName,
  defaultSubject = '',
  defaultBody = '',
  onSent,
  className,
}: EmailComposeProps): React.JSX.Element {
  const [subject, setSubject] = useState(defaultSubject)
  const [body, setBody] = useState(defaultBody)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [showTags, setShowTags] = useState(false)
  const [activeField, setActiveField] = useState<'subject' | 'body'>('body')

  const subjectRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  function insertTag(tag: string): void {
    const ref = activeField === 'subject' ? subjectRef : bodyRef
    const el = ref.current
    if (!el) return

    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? start
    const before = el.value.slice(0, start)
    const after = el.value.slice(end)
    const newValue = before + tag + after

    if (activeField === 'subject') {
      setSubject(newValue)
    } else {
      setBody(newValue)
    }

    // Restore cursor position after the inserted tag
    requestAnimationFrame(() => {
      el.focus()
      const cursorPos = start + tag.length
      el.setSelectionRange(cursorPos, cursorPos)
    })

    setShowTags(false)
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    setError(null)
    setSuccess(false)

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
        const res = await fetch('/api/email/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          credentials: 'same-origin',
          body: JSON.stringify({ leadId, subject: subject.trim(), body: body.trim() }),
        })

        if (!res.ok) {
          let message = `Failed to send email (${res.status})`
          try {
            const responseBody = (await res.json()) as { error?: { message?: string } }
            if (responseBody.error?.message) message = responseBody.error.message
          } catch {
            // ignore parse failure
          }
          setError(message)
          return
        }

        const responseBody = (await res.json()) as {
          data: { messageId: string; threadId: string }
        }
        setSuccess(true)
        onSent?.(responseBody.data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to send email.')
      }
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn('flex flex-col gap-3 rounded-md border bg-card p-4', className)}
      aria-busy={isPending || undefined}
      aria-label="Compose email"
    >
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
          ref={subjectRef}
          id="email-subject"
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          onFocus={() => setActiveField('subject')}
          placeholder="Email subject…"
          className={inputClasses}
          disabled={isPending}
        />
      </div>

      {/* Body */}
      <div>
        <label
          htmlFor="email-body"
          className="block text-xs font-medium text-foreground mb-1"
        >
          Body
        </label>
        <textarea
          ref={bodyRef}
          id="email-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onFocus={() => setActiveField('body')}
          rows={8}
          placeholder="Write your email…"
          className={cn(
            'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          )}
          disabled={isPending}
        />
      </div>

      {/* Personalization tag toolbar */}
      <div className="relative">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowTags((prev) => !prev)}
          disabled={isPending}
          aria-expanded={showTags}
          aria-controls="personalization-tags-menu"
        >
          <Tag className="size-3.5" aria-hidden="true" />
          <span>Insert tag</span>
        </Button>

        {showTags && (
          <div
            id="personalization-tags-menu"
            role="menu"
            className="absolute bottom-full left-0 z-10 mb-1 flex flex-wrap gap-1 rounded-md border bg-popover p-2 shadow-md"
          >
            {PERSONALIZATION_TAGS.map(({ tag, label }) => (
              <button
                key={tag}
                type="button"
                role="menuitem"
                onClick={() => insertTag(tag)}
                className="rounded-md border bg-background px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Error / success messages */}
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
          Email sent successfully.
        </div>
      ) : null}

      {/* Actions */}
      <div className="flex justify-end">
        <Button
          type="submit"
          size="sm"
          disabled={isPending || !leadEmail}
        >
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              <span>Sending…</span>
            </>
          ) : (
            <>
              <Send className="size-3.5" aria-hidden="true" />
              <span>Send email</span>
            </>
          )}
        </Button>
      </div>
    </form>
  )
}

const inputClasses =
  'flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'
