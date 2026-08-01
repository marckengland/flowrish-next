'use client'

import { useState, useTransition } from 'react'
import { Copy, Loader2, Mail, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface GeneratedEmail {
  subject: string
  body: string
}

interface GenerateEmailResponse {
  data?: GeneratedEmail
  error?: { code?: string; message?: string }
}

export interface EmailGeneratorProps {
  /** The lead to draft an email for. Required for the API call. */
  leadId: string
  /** Optional display name — rendered as context in the panel title. */
  leadName?: string
  /** Optional callback invoked with the draft when "Use this draft" is clicked. */
  onUseDraft?: (draft: GeneratedEmail) => void
}

const TONE_OPTIONS = [
  'Helpful and friendly',
  'Professional and direct',
  'Casual and conversational',
  'Formal and authoritative',
  'Warm and empathetic',
] as const

const GOAL_OPTIONS = [
  'Book a meeting',
  'Get a reply',
  'Share a resource',
  'Introduce a value proposition',
  'Follow up on a previous conversation',
  'Re-engage a cold prospect',
] as const

/**
 * AI email draft surface.
 *
 * Renders an inline expandable panel: collapsed by default, expanded
 * shows controls for tone / goal / freeform instructions / "include
 * recent interactions" toggle. The form posts to
 * `POST /api/ai/generate-email`, then displays the editable subject and
 * body. "Use draft" hands the draft to the parent (e.g. the email
 * compose surface) via `onUseDraft`. "Copy" puts a plain-text version on
 * the clipboard.
 *
 * Failure modes always surface the generic server message — we never
 * leak provider internals (Requirement 8.5).
 *
 * Validates: Requirements 8.1, 8.4, 8.5
 */
export function EmailGenerator({
  leadId,
  leadName,
  onUseDraft,
}: EmailGeneratorProps): React.JSX.Element {
  const [open, setOpen] = useState(false)

  // Controls
  const [instructions, setInstructions] = useState('')
  const [tone, setTone] = useState<string>(TONE_OPTIONS[0])
  const [goal, setGoal] = useState<string>(GOAL_OPTIONS[0])
  const [includeContext, setIncludeContext] = useState(true)

  // Result state
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [hasDraft, setHasDraft] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [pending, startTransition] = useTransition()

  function generate(): void {
    if (pending) return
    if (!leadId) {
      setError('Save the lead first so the AI can use its context.')
      return
    }
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
          body: JSON.stringify({
            leadId,
            tone,
            goal,
            instructions: instructions.trim() || undefined,
            includeContext,
          }),
        })
        const json = (await res.json().catch(() => ({}))) as GenerateEmailResponse
        if (!res.ok) {
          setError(json.error?.message ?? 'AI service temporarily unavailable')
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

  async function copyDraft(): Promise<void> {
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

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <Sparkles className="size-3.5" aria-hidden="true" />
        <span>AI generate</span>
      </Button>
    )
  }

  return (
    <section
      aria-labelledby="email-generator-heading"
      className="space-y-3 rounded-lg border border-ai/30 bg-ai-subtle p-[18px]"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            id="email-generator-heading"
            className="flex items-center gap-2 text-sm font-semibold text-ai"
          >
            <Sparkles
              className="size-4 text-ai"
              aria-hidden="true"
            />
            AI email generator
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {leadName
              ? `Generate a personalized email for ${leadName}.`
              : 'Generate a personalized email using lead context.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </header>

      <div>
        <label
          htmlFor="ai-email-instructions"
          className="mb-1 block text-xs font-medium"
        >
          What should this email do?
        </label>
        <textarea
          id="ai-email-instructions"
          rows={2}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="e.g. Introduce our platform and highlight how it can help their sales team scale outbound…"
          className="w-full rounded-[10px] border border-input bg-card px-3 py-2 text-sm shadow-sm transition-[color,box-shadow,border-color] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand/15"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="ai-email-tone" className="eyebrow mb-1.5 block">
            Tone
          </label>
          <select
            id="ai-email-tone"
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            className={inputClasses}
          >
            {TONE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ai-email-goal" className="eyebrow mb-1.5 block">
            Goal / CTA
          </label>
          <select
            id="ai-email-goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            className={inputClasses}
          >
            {GOAL_OPTIONS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={includeContext}
          onChange={(e) => setIncludeContext(e.target.checked)}
          className="size-3.5 rounded border"
        />
        Include recent interaction history for contextual threading
      </label>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={generate}
          disabled={pending || !leadId}
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="size-3.5" aria-hidden="true" />
          )}
          <span>{pending ? 'Generating…' : hasDraft ? 'Regenerate' : 'Generate email'}</span>
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {hasDraft ? (
        <div className="space-y-2 rounded-lg border bg-card p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-brand-emphasis">
              Email generated — edit before using.
            </p>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={copyDraft}
              >
                <Copy className="size-3.5" aria-hidden="true" />
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </Button>
              {onUseDraft ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={useDraft}
                >
                  <Mail className="size-3.5" aria-hidden="true" />
                  <span>Use this</span>
                </Button>
              ) : null}
            </div>
          </div>

          <div>
            <label
              htmlFor="ai-email-gen-subject"
              className="mb-1 block text-xs font-medium"
            >
              Subject
            </label>
            <input
              id="ai-email-gen-subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className={inputClasses}
            />
          </div>

          <div>
            <label
              htmlFor="ai-email-gen-body"
              className="mb-1 block text-xs font-medium"
            >
              Body (HTML)
            </label>
            <textarea
              id="ai-email-gen-body"
              rows={8}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className={cn(
                'w-full rounded-[10px] border border-input bg-card px-3 py-2 font-mono text-xs shadow-sm',
                'transition-[color,box-shadow,border-color] focus-visible:outline-none focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand/15',
              )}
            />
          </div>
        </div>
      ) : null}
    </section>
  )
}

const inputClasses =
  'flex h-9 w-full rounded-[10px] border border-input bg-card px-3 py-1 text-sm text-foreground shadow-sm transition-[color,box-shadow,border-color] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand/15 disabled:cursor-not-allowed disabled:opacity-50'

/**
 * Lightweight HTML stripping for the clipboard copy path. The generated
 * body is HTML, but users typically want plain text when pasting into
 * another editor. This intentionally avoids pulling in a DOM parser
 * dependency — it drops tags and collapses entities for the most common
 * cases.
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
