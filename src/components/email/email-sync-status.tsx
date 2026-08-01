'use client'

import { useState, useTransition } from 'react'
import {
  AlertCircle,
  CheckCircle,
  Loader2,
  RefreshCw,
} from 'lucide-react'

import { Button } from '@/components/ui/button'

export interface EmailSyncStatusProps {
  /** Optional extra class for the wrapper. */
  className?: string
}

/**
 * Manual Gmail sync trigger. Posts to `/api/email/sync`, which queues
 * an Inngest event so the actual Gmail API pagination happens in the
 * background — the click returns as soon as the event is accepted.
 *
 * Surfaces three states: idle, in-flight, success / failure. The error
 * banner reuses the structured server message so the user sees the
 * same diagnostic regardless of whether the failure happened in the
 * permission check, the EmailAccount lookup, or the Inngest send.
 */
export function EmailSyncStatus({
  className,
}: EmailSyncStatusProps): React.JSX.Element {
  const [result, setResult] = useState<'success' | 'error' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function syncNow(): void {
    setResult(null)
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch('/api/email/sync', {
          method: 'POST',
          credentials: 'same-origin',
        })
        if (!res.ok) {
          let message = `Email sync failed (${res.status})`
          try {
            const body = (await res.json()) as { error?: { message?: string } }
            if (body.error?.message) message = body.error.message
          } catch {
            // ignore parse failure
          }
          setResult('error')
          setError(message)
          return
        }
        setResult('success')
      } catch (err) {
        setResult('error')
        setError(err instanceof Error ? err.message : 'Email sync failed.')
      }
    })
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={syncNow}
          disabled={pending}
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="size-3.5" aria-hidden="true" />
          )}
          <span>Sync now</span>
        </Button>

        {result === 'success' && !pending ? (
          <span className="flex items-center gap-1 text-xs text-brand-emphasis">
            <CheckCircle className="size-3" aria-hidden="true" />
            Sync queued
          </span>
        ) : null}
      </div>

      {result === 'error' && error ? (
        <div
          role="alert"
          className="mt-2 flex items-start gap-2 rounded-[10px] border border-danger/30 bg-danger-subtle p-2.5 text-xs text-danger-foreground"
        >
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <p>{error}</p>
        </div>
      ) : null}
    </div>
  )
}
