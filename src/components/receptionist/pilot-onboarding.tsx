'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import {
  pilotAcceptSchema,
  pilotStatusSchema,
  pilotTokenSchema,
  type PilotStatus,
} from '@/lib/pilot-onboarding'
import { readPilot, pilotJsonBody, PilotClientError } from '@/lib/pilot-client'
const field =
  'mt-1 min-h-11 w-full rounded-md border bg-background px-3 py-2 text-sm'

export function PilotOnboarding(): React.JSX.Element {
  const [status, setStatus] = useState<PilotStatus | null>(null),
    [busy, setBusy] = useState(false),
    pending = useRef(false),
    started = useRef(false),
    token = useRef<string | null>(null)
  const [name, setName] = useState(''),
    [slug, setSlug] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState('')
  const perform = useCallback(async (work: () => Promise<void>) => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await work()
    } catch (failure) {
      setError(
        failure instanceof PilotClientError
          ? failure.message
          : 'The request could not be confirmed. Reload invitation status before trying again.',
      )
    } finally {
      pending.current = false
      setBusy(false)
    }
  }, [])
  const refresh = useCallback(async () => {
    await perform(async () => {
      if (token.current) {
        await readPilot(
          '/api/pilot/session',
          z.object({ received: z.literal(true) }),
          pilotJsonBody({ token: token.current }),
        )
        token.current = null
      }
      setStatus(await readPilot('/api/pilot/status', pilotStatusSchema))
    })
  }, [perform])
  useEffect(() => {
    if (started.current) return
    started.current = true
    const fragment = window.location.hash
    if (fragment) {
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search,
      )
      const params = new URLSearchParams(fragment.slice(1)),
        candidate = params.get('invite')
      if (
        params.size === 1 &&
        params.getAll('invite').length === 1 &&
        pilotTokenSchema.safeParse(candidate).success
      )
        token.current = candidate
      else {
        void perform(async () => {
          await readPilot(
            '/api/pilot/session',
            z.object({ cleared: z.literal(true) }),
            { method: 'DELETE' },
          )
          setStatus({ state: 'unavailable' })
        })
        return
      }
    }
    void refresh()
  }, [perform, refresh])
  function changeName(value: string) {
    setName(value)
    setConfirmed(false)
  }
  async function accept() {
    const input = pilotAcceptSchema.safeParse({ name, slug, confirmed })
    if (!input.success) {
      setError('Check the business details and confirm before continuing.')
      return
    }
    await perform(async () => {
      setStatus(
        await readPilot(
          '/api/pilot/accept',
          pilotStatusSchema,
          pilotJsonBody(input.data),
        ),
      )
      setConfirmed(false)
    })
  }
  async function leave(href: string) {
    await perform(async () => {
      await readPilot(
        '/api/pilot/session',
        z.object({ cleared: z.literal(true) }),
        { method: 'DELETE' },
      )
      window.location.assign(href)
    })
  }
  return (
    <div className="mx-auto max-w-xl space-y-6 px-5 py-10 sm:py-16">
      <header className="space-y-3">
        <Link
          href="/"
          onClick={(event) => {
            event.preventDefault()
            void leave('/')
          }}
          className="inline-flex min-h-11 items-center text-lg font-semibold"
        >
          Flowrish
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">
          Set up your pilot workspace
        </h1>
        <p className="text-sm text-muted-foreground">
          Use your private invitation and the invited verified email to create
          your business workspace. Your workspace starts with the receptionist
          widget off.
        </p>
      </header>
      {busy && (
        <p role="status" aria-label="Pilot setup status">
          Checking pilot setup…
        </p>
      )}
      {error && (
        <p
          role="alert"
          aria-label="Pilot setup error"
          className="rounded-lg border p-3 text-sm"
        >
          {error}
        </p>
      )}
      <Button variant="outline" disabled={busy} onClick={() => void refresh()}>
        Reload invitation status
      </Button>
      {status?.state === 'missing' && (
        <p>
          Open the private pilot link Flowrish shared with you. Signing in alone
          does not provide an invitation.
        </p>
      )}
      {status?.state === 'sign_in' && (
        <div className="space-y-3">
          <p>
            Sign in using the email invited by Flowrish. If you sign in on
            another device, reopen your private link there afterward.
          </p>
          <Link
            href="/login?next=/pilot"
            className="inline-flex min-h-11 items-center font-medium underline"
          >
            Sign in with the invited email
          </Link>
        </div>
      )}
      {status?.state === 'unavailable' && (
        <div className="space-y-3">
          <p>
            This invitation is unavailable for this account. It may be expired,
            revoked, or intended for a different verified email. Reopen your
            private link or contact Flowrish.
          </p>
          <Link
            href="/login?next=/pilot"
            className="inline-flex min-h-11 items-center underline"
          >
            Sign in with the invited email
          </Link>
        </div>
      )}
      {status?.state === 'existing_workspace' && (
        <p>
          This account already belongs to a workspace. Contact Flowrish before
          creating another; this invitation does not change your existing
          membership.
        </p>
      )}
      {status?.state === 'ready' && (
        <form
          className="space-y-5 rounded-xl border bg-card p-5"
          onSubmit={(event) => {
            event.preventDefault()
            void accept()
          }}
        >
          <p className="text-sm text-muted-foreground">
            Invitation expires{' '}
            <time dateTime={status.expiresAt}>
              {new Date(status.expiresAt).toLocaleString()}
            </time>
            .
          </p>
          <label className="block text-sm font-medium">
            Business name
            <input
              className={field}
              value={name}
              maxLength={100}
              required
              autoComplete="organization"
              onChange={(event) => changeName(event.target.value)}
              disabled={busy}
            />
          </label>
          <label className="block text-sm font-medium">
            Workspace identifier
            <input
              className={field}
              value={slug}
              maxLength={50}
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              placeholder="my-business"
              onChange={(event) => {
                setSlug(event.target.value)
                setConfirmed(false)
              }}
              disabled={busy}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Choose a short, unique identifier using lowercase letters, numbers
            and hyphens.
          </p>
          <label className="flex min-h-11 items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            I confirm these details and want to create my own workspace.
          </label>
          <Button
            type="submit"
            className="min-h-11"
            disabled={busy || !confirmed || !name.trim() || !slug.trim()}
          >
            Create my pilot workspace
          </Button>
          <p className="text-xs text-muted-foreground">
            This creates your organization and owner membership. Receptionist
            setup follows. It does not enable a widget, connect AI, or send a
            message.
          </p>
        </form>
      )}
      {status?.state === 'joined' && (
        <section
          aria-label="Pilot workspace receipt"
          className="space-y-4 rounded-xl border p-5"
        >
          <h2 className="text-xl font-semibold">
            Your pilot workspace is ready
          </h2>
          <p className="break-words [overflow-wrap:anywhere]">
            {status.organizationName}
          </p>
          {status.continueHref ? (
            <Link
              href={status.continueHref}
              onClick={(event) => {
                event.preventDefault()
                void leave('/receptionist/setup')
              }}
              className="inline-flex min-h-11 items-center font-semibold underline"
            >
              Continue receptionist setup
            </Link>
          ) : (
            <p>
              Choose this workspace before continuing setup, or contact Flowrish
              for help. This invitation will not create another workspace.
            </p>
          )}
        </section>
      )}
    </div>
  )
}
