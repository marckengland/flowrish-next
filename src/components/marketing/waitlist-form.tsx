'use client'

import { useState, type FormEvent } from 'react'
import { ArrowRight, Check } from 'lucide-react'

/**
 * Private-beta email-capture form for the marketing landing page. Posts to
 * /api/waitlist. Never reveals whether an email was already on the list — the
 * API returns the same success shape either way.
 *
 * `tone="dark"` styles it for the dark FINAL CTA panel; default styles it for
 * light sections.
 */
export function WaitlistForm({
  tone = 'light',
}: {
  tone?: 'light' | 'dark'
}): React.JSX.Element {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const dark = tone === 'dark'

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    setError(null)
    setIsLoading(true)
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setError(
          data.error?.message ??
            "Couldn't add you to the list. Please try again.",
        )
        return
      }
      setSubmitted(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  if (submitted) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={`mx-auto flex max-w-[440px] items-center justify-center gap-2.5 rounded-xl border px-5 py-4 text-[15px] font-medium ${
          dark
            ? 'border-white/20 bg-white/10 text-white'
            : 'border-border bg-muted text-foreground'
        }`}
      >
        <Check className="size-[18px] shrink-0 text-brand" aria-hidden="true" />
        You&apos;re on the list. We&apos;ll email you when a spot opens.
      </div>
    )
  }

  const labelClass = dark ? 'text-white/80' : 'text-muted-foreground'
  const inputClass = dark
    ? 'h-12 w-full rounded-xl border border-white/20 bg-white/5 px-4 text-[15px] text-white placeholder:text-white/40 transition-[border-color,box-shadow] focus:border-white/50 focus:outline-none focus:ring-2 focus:ring-white/25'
    : 'h-12 w-full rounded-xl border border-border bg-card px-4 text-[15px] text-foreground placeholder:text-muted-foreground transition-[border-color,box-shadow] focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/15'

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="mx-auto flex max-w-[440px] flex-col gap-3 text-left"
    >
      <div aria-live="assertive">
        {error && (
          <div
            role="alert"
            className={`rounded-xl border px-4 py-3 text-[14px] ${
              dark
                ? 'border-red-300/40 bg-red-500/15 text-red-100'
                : 'border-danger/30 bg-danger-subtle text-danger-foreground'
            }`}
          >
            {error}
          </div>
        )}
      </div>

      <div>
        <label
          htmlFor="waitlist-name"
          className={`mb-1.5 block text-[13px] ${labelClass}`}
        >
          Name <span className="opacity-60">(optional)</span>
        </label>
        <input
          id="waitlist-name"
          name="name"
          type="text"
          autoComplete="name"
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
          placeholder="Your name"
        />
      </div>

      <div>
        <label
          htmlFor="waitlist-email"
          className={`mb-1.5 block text-[13px] ${labelClass}`}
        >
          Work email
        </label>
        <input
          id="waitlist-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
          placeholder="you@company.com"
        />
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className={`mt-1 inline-flex h-12 items-center justify-center gap-2 rounded-xl px-6 text-[15px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          dark
            ? 'bg-white text-[oklch(0.17_0_0)] hover:opacity-90'
            : 'bg-brand text-brand-foreground hover:bg-brand-hover'
        }`}
      >
        {isLoading ? 'Joining…' : 'Join the waitlist'}
        {!isLoading && <ArrowRight className="size-[17px]" aria-hidden="true" />}
      </button>
    </form>
  )
}
