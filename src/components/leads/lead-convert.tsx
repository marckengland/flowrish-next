'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRightLeft, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { convertLead } from '@/server/actions/leads'

export interface LeadConvertProps {
  leadId: string
  /**
   * Whether the lead is already closed (Closed Won or Closed Lost).
   * A closed lead cannot be converted again because the service requires
   * an open deal to move into "Closed Won" (Requirement 29.2).
   */
  alreadyConverted: boolean
}

/**
 * Convert-to-contact button with an inline confirmation prompt.
 *
 * Wraps `convertLead` from `@/server/actions/leads`. On success the router
 * revalidates and reloads the current route so the detail page reflects
 * the new "Closed Won" stage and linked contact.
 *
 * Validates: Requirements 29.1, 29.2, 29.3, 29.4, 29.5
 */
export function LeadConvert({
  leadId,
  alreadyConverted,
}: LeadConvertProps): React.JSX.Element {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  if (alreadyConverted) {
    return (
      <p className="text-sm text-muted-foreground">
        This lead has already been converted or closed.
      </p>
    )
  }

  function handleConvert(): void {
    setError(null)
    startTransition(async () => {
      const result = await convertLead(leadId)
      if (result && 'error' in result && result.error) {
        setError(result.error)
        return
      }
      setConfirming(false)
      router.refresh()
    })
  }

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setConfirming(true)}
      >
        <ArrowRightLeft className="size-4" aria-hidden="true" />
        <span>Convert to contact</span>
      </Button>
    )
  }

  return (
    <div
      role="alertdialog"
      aria-labelledby="convert-lead-heading"
      aria-describedby="convert-lead-description"
      className="flex flex-col gap-3 rounded-md border bg-card p-4"
    >
      <div>
        <h3 id="convert-lead-heading" className="text-sm font-semibold">
          Convert this lead into a contact?
        </h3>
        <p
          id="convert-lead-description"
          className="mt-1 text-sm text-muted-foreground"
        >
          The lead will move to the Closed Won stage, a linked contact will
          be created, and any active cadence enrollments for this lead will
          exit with reason <code>lead_converted</code>.
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setConfirming(false)
            setError(null)
          }}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleConvert}
          disabled={isPending}
        >
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              <span>Converting…</span>
            </>
          ) : (
            <span>Convert lead</span>
          )}
        </Button>
      </div>
    </div>
  )
}
