'use client'

import { useState, useTransition } from 'react'
import { Copy, Mail, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * Shape returned by `POST /api/ai/generate-email` on success.
 */
interface GeneratedEmail {
  subject: string
  body: string
}

interface GenerateEmailResponse {
  data?: GeneratedEmail
  error?: { code?: string; message?: string }
}

export interface EmailGeneratorProps {
  /** The lead to draft an email for. */
  leadId: string
  /** Optional display name — rendered as context in the panel title. */
  leadName?: string
  /** Optional callback invoked with the draft when "Use this draft" is clicked. */
  onUseDraft?: (draft: GeneratedEmail) => void
}

/**
 * AI email draft interface.
 *
 * Triggers `POST /api/ai/generate-email`, which the route handler forwards to
 * the `generateEmail` service. The service fetches lead context (name, title,
 * company, last 5 interactions) and the admin-configured system prompt
 * (when active), then calls the AI provider and returns a structured
 * `{ subject, body }` payload (Requirement 8.1, 8.4).
 *
 * Any failure surfaces the generic server message — we never display raw
 * exception details or provider metadata (Requirement 8.5).
 *
 * The generated subject and body are rendered as editable fields so the
 * user can tweak the draft before using it elsewhere (for example, piping
 * it into the email compose surface via `onUseDraft`).
 *
 * Validates: Requirements 8.1, 8.4, 8.5
 */
export function EmailGenerator({
  leadId,
  leadName,
  onUseDraft,
}: EmailGeneratorProps): React.JSX.Element {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [hasDraft, setHasDraft] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [pending, startTransition] = useTransition()

  function generate(): void {
    if (pending) return
    setError(null)
    setCopied(false)
    startTransition(async () => {
      try {
        const res = await fetch('/api/ai/generate-email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          credentials: 'same-origin',
          body: JSON.stringify({ leadId }),
        })
        const json = (await res.json().catch(() => ({}))) as GenerateEmailResponse
        if (!res.ok) {
          setError(
            json.error?.message ?? 'AI service temporarily unavailable',
          )
          return
        }
        const draft = json.data
        if (!draft) {
          setError('AI service temporarily unavailable')
          return
        }
        setSubject(draft.subject ?? '')
        setBody(draft.body ?? '')
        setHasDraft(true)
      } catch {
        setError('AI service temporarily unavailable')
      }
    })
  }

  async function copyBody(): Promise<void> {
    setError(null)
    try {
      const text = `Subject: ${subject}\n\n${stripHtml(body)}`
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setError('Unable to copy to clipboard')
    }
  }

  function useDraft(): void {
    if (!hasDraft) return
    onUseDraft?.({ subject, body })
  }

  return (
    <section
      aria-labelledby="email-generator-heading"
      className="space-y-4 rounded-lg border bg-card p-4 shadow-sm"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="email-generator-heading"
            className="flex items-center gap-2 text-sm font-semibold text-foreground"
          >
            <Sparkles className="size-4 text-primary" aria-hidden="true" />
            AI Email Draft
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {leadName
              ? `Generate a personalized email for ${leadName}.`
              : 'Generate a personalized email using the lead context.'}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={generate}
          disabled={pending}
          aria-label={hasDraft ? 'Regenerate email draft' : 'Generate email draft'}
        >
          <Sparkles className="size-3.5" aria-hidden="true" />
          {pending ? 'Generating…' : hasDraft ? 'Regenerate' : 'Generate'}
        </Button>
      </header>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {hasDraft ? (
        <div className="space-y-3">
          <div>
            <label
              htmlFor="email-gen-subject"
              className="block text-sm font-medium text-foreground mb-1.5"
            >
              Subject
            </label>
            <input
              id="email-gen-subject"
              type="text"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div>
            <label
              htmlFor="email-gen-body"
              className="block text-sm font-medium text-foreground mb-1.5"
            >
              Body
            </label>
            <textarea
              id="email-gen-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={10}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Draft is HTML-formatted. Edit before sending.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={copyBody}
              aria-label="Copy draft to clipboard"
            >
              <Copy className="size-3.5" aria-hidden="true" />
              {copied ? 'Copied' : 'Copy'}
            </Button>
            {onUseDraft ? (
              <Button
                type="button"
                size="sm"
                onClick={useDraft}
                aria-label="Use this draft"
              >
                <Mail className="size-3.5" aria-hidden="true" />
                Use draft
              </Button>
            ) : null}
          </div>
        </div>
      ) : !pending ? (
        <p className="rounded-lg border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
          No draft yet. Click <strong>Generate</strong> to ask the AI for a
          personalized email based on this lead&rsquo;s context.
        </p>
      ) : null}
    </section>
  )
}

/**
 * Lightweight HTML stripping for the clipboard copy path. The generated
 * body is HTML (Requirement 8.1), but users typically want plain text when
 * pasting into another editor. This intentionally avoids pulling in a DOM
 * parser dependency — it drops tags and collapses entities for the most
 * common cases.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}
