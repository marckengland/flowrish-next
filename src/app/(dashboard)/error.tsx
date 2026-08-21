'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * Error boundary for the authenticated dashboard. Catches render/data errors
 * thrown by any dashboard route and shows a recoverable surface instead of a
 * blank screen. `reset()` re-renders the segment; the secondary action routes
 * back to a known-good page.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}): React.JSX.Element {
  const router = useRouter()

  useEffect(() => {
    // Surface for logging/observability; the digest links to the server log.
    console.error(error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5 px-6 text-center">
      <span
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-full bg-danger-subtle text-danger-foreground"
      >
        <AlertTriangle className="size-6" />
      </span>
      <div className="max-w-sm">
        <h1 className="text-lg font-semibold text-foreground">
          Something went wrong
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          This section failed to load. You can try again, or head back to your
          dashboard.
        </p>
        {error.digest ? (
          <p className="mt-2 font-mono text-[11px] text-muted-foreground/70">
            Ref: {error.digest}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2.5">
        <Button onClick={reset}>Try again</Button>
        <Button variant="outline" onClick={() => router.push('/dashboard')}>
          Go to dashboard
        </Button>
      </div>
    </div>
  )
}
