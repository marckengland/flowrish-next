'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'

export interface DeleteCompanyDialogProps {
  open: boolean
  onClose: () => void
  companyId: string
  companyName: string
  /** Number of leads currently associated with this company. */
  leadCount: number
  /** Optional callback fired after a successful delete. Defaults to redirecting to /companies. */
  onDeleted?: () => void
}

/**
 * Confirm-and-delete dialog for companies.
 *
 * The original frontend warned the user when there were associated
 * leads — those leads survive the delete but lose their companyId
 * association. We surface that explicitly here so the rep isn't
 * surprised when their lead pages stop showing the company name.
 *
 * On success we redirect to /companies (or invoke the caller's
 * `onDeleted` if they want to handle navigation themselves).
 */
export function DeleteCompanyDialog({
  open,
  onClose,
  companyId,
  companyName,
  leadCount,
  onDeleted,
}: DeleteCompanyDialogProps): React.JSX.Element {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleDelete(): void {
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/companies/${companyId}`, {
          method: 'DELETE',
          credentials: 'same-origin',
        })
        if (!res.ok) {
          let message = `Delete failed (${res.status})`
          try {
            const body = (await res.json()) as { error?: { message?: string } }
            if (body.error?.message) message = body.error.message
          } catch {
            // ignore
          }
          setError(message)
          return
        }
        if (onDeleted) {
          onDeleted()
        } else {
          router.push('/companies')
          router.refresh()
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Delete failed.')
      }
    })
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-full bg-danger-subtle"
          >
            <AlertTriangle className="size-4 text-danger-foreground" />
          </span>
          Delete company
        </span>
      }
      description="This action cannot be undone."
      size="md"
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={pending}
          >
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                <span>Deleting…</span>
              </>
            ) : (
              <span>Yes, delete company</span>
            )}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm">
          Are you sure you want to delete{' '}
          <span className="font-semibold">{companyName}</span>?
        </p>

        {leadCount > 0 ? (
          <div
            role="alert"
            className="rounded-lg border border-warning/40 bg-warning-subtle p-3 text-sm text-warning-foreground"
          >
            <p className="flex items-center gap-2 font-medium">
              <AlertTriangle className="size-4" aria-hidden="true" />
              This company has {leadCount} associated lead
              {leadCount === 1 ? '' : 's'}.
            </p>
            <p className="mt-1 text-xs">
              Deleting this company will remove the company association from
              those leads. The leads themselves are not deleted.
            </p>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-danger-foreground">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}
