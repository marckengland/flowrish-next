'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Mail } from 'lucide-react'

import { createSupabaseBrowser } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AuthBrandPanel } from '@/components/layout/auth-brand-panel'
import { safeAuthNext } from '@/lib/pilot-onboarding'

/**
 * Login page with email magic link and Google OAuth sign-in options.
 * This is a client component that uses the browser Supabase client
 * to initiate auth flows.
 *
 * Validates: Requirements 1.1, 1.3
 */
export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const supabase = createSupabaseBrowser()

  // Safety net: if the OAuth redirect gets swallowed (popup blocker, ad
  // blocker, browser extension), release the loading state after a
  // reasonable wait so the button isn't stuck forever.
  useEffect(() => {
    if (!oauthLoading) return
    const t = window.setTimeout(() => {
      setOauthLoading(false)
      setError(
        'Redirect blocked. Check your browser settings and try Google again, or use a magic link.',
      )
    }, 8000)
    return () => window.clearTimeout(t)
  }, [oauthLoading])

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setMessage(null)

    const { error: signInError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm`,
      },
    })

    if (signInError) {
      setError(signInError.message)
    } else {
      setMessage('Check your email for a magic link to sign in.')
    }

    setLoading(false)
  }

  async function handleGoogleOAuth() {
    setOauthLoading(true)
    setError(null)

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        ...(safeAuthNext(
          new URLSearchParams(window.location.search).get('next'),
        ) === '/pilot'
          ? { queryParams: { prompt: 'select_account' } }
          : {}),
      },
    })

    if (oauthError) {
      setError(oauthError.message)
      setOauthLoading(false)
    }
    // On success the browser navigates away and this component
    // unmounts, so no explicit success handling is needed.
  }

  const busy = loading || oauthLoading

  return (
    <div className="grid min-h-screen bg-card lg:grid-cols-[1.05fr_1fr]">
      <AuthBrandPanel />

      <div className="flex items-center justify-center bg-card px-6 py-12">
        <div className="w-full max-w-[380px]">
          <h1 className="mb-1.5 text-[26px] font-bold tracking-[-0.02em] text-foreground">
            Welcome back
          </h1>
          <p className="mb-7 text-[14.5px] text-muted-foreground">
            Sign in to your Flowrish workspace.
          </p>

          {/* Google OAuth */}
          <Button
            variant="outline"
            className="h-[46px] w-full rounded-[11px] text-[14.5px] font-semibold"
            onClick={handleGoogleOAuth}
            disabled={busy}
          >
            <svg className="size-[17px]" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            {oauthLoading ? 'Redirecting…' : 'Continue with Google'}
          </Button>

          <div className="my-[22px] flex items-center gap-3.5">
            <span className="h-px flex-1 bg-border" />
            <span className="font-mono text-[11px] tracking-[0.06em] text-muted-foreground">
              OR
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>

          {/* Magic Link Form */}
          <form onSubmit={handleMagicLink}>
            <label
              htmlFor="email"
              className="mb-1.5 block text-[13px] font-medium text-foreground"
            >
              Email address
            </label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              autoComplete="email"
              className="mb-3.5"
            />
            <Button
              type="submit"
              className="h-[46px] w-full rounded-[11px] text-[14.5px] font-semibold"
              disabled={busy || !email}
            >
              <Mail className="size-4" />
              {loading ? 'Sending…' : 'Send magic link'}
            </Button>
          </form>

          {/* Status Messages */}
          {message && (
            <p className="mt-4 text-center text-sm text-brand-emphasis">
              {message}
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="mt-4 text-center text-sm text-danger-foreground"
            >
              {error}
            </p>
          )}

          <p className="mt-6 text-center text-[13.5px] text-muted-foreground">
            New to Flowrish?{' '}
            <Link
              href="/onboarding"
              className="font-semibold text-brand-emphasis hover:underline"
            >
              Create a workspace
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
