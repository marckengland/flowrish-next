'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Loader2, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  activateCadence,
  archiveCadence,
} from '@/server/actions/cadences'
import {
  useDeleteCadenceMutation,
  type CadenceDetail,
} from '@/hooks/use-cadences'

/**
 * Cadence settings tab — exposes the state-machine controls plus delete.
 *
 * - **Activate**: DRAFT → ACTIVE (requires at least one step). Server
 *   action rejects if preconditions fail and the error surfaces here.
 * - **Archive**: ACTIVE → ARCHIVED, which also exits all ACTIVE
 *   enrollments on the server (Requirement 6.3, 32.3).
 * - **Delete**: Server rejects delete when active enrollments exist
 *   (Requirement 32.4). The confirm prompt calls out that restriction.
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 32.1, 32.2, 32.3, 32.4
 */

export interface CadenceSettingsProps {
  cadence: CadenceDetail
  activeEnrollmentCount: number
  canManage: boolean
}

export function CadenceSettings({
  cadence,
  activeEnrollmentCount,
  canManage,
}: CadenceSettingsProps): React.JSX.Element {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pending, startTransition] = useTransition()

  const deleteMutation = useDeleteCadenceMutation()

  const stepCount = cadence.steps.length
  const canActivate = stepCount > 0 && cadence.status === 'DRAFT'

  function runActivate(): void {
    setError(null)
    startTransition(async () => {
      const result = await activateCadence(cadence.id)
      if (result && 'error' in result && result.error) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  function runArchive(): void {
    setError(null)
    startTransition(async () => {
      const result = await archiveCadence(cadence.id)
      if (result && 'error' in result && result.error) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  function runDelete(): void {
    setError(null)
    startTransition(async () => {
      try {
        await deleteMutation.mutateAsync(cadence.id)
        router.push('/cadences')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete.')
      }
    })
  }

  if (!canManage) {
    return (
      <section aria-label="Cadence settings" className="flex flex-col gap-3">
        <p className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
          You don&apos;t have permission to change cadence settings.
        </p>
      </section>
    )
  }

  return (
    <section aria-label="Cadence settings" className="flex flex-col gap-4">
      {error ? (
        <p role="alert" className="text-sm text-danger-foreground">
          {error}
        </p>
      ) : null}

      <div className="rounded-md border bg-card p-4">
        <h3 className="text-sm font-semibold">Lifecycle</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Current status: <span className="font-medium text-foreground">{cadence.status}</span>
          {' · '}
          {stepCount} step{stepCount === 1 ? '' : 's'} defined
          {' · '}
          {activeEnrollmentCount} active enrollment{activeEnrollmentCount === 1 ? '' : 's'}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {cadence.status === 'DRAFT' && (
            <Button
              type="button"
              size="sm"
              onClick={runActivate}
              disabled={pending || !canActivate}
              title={
                canActivate
                  ? undefined
                  : 'Add at least one step before activating the cadence.'
              }
            >
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  <span>Activating…</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                  <span>Activate cadence</span>
                </>
              )}
            </Button>
          )}
          {cadence.status === 'ACTIVE' && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={runArchive}
              disabled={pending}
            >
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  <span>Archiving…</span>
                </>
              ) : (
                <span>Archive cadence</span>
              )}
            </Button>
          )}
          {cadence.status === 'ARCHIVED' && (
            <p className="text-sm text-muted-foreground">
              This cadence is archived. Steps are read-only and no new leads
              can be enrolled.
            </p>
          )}
        </div>
      </div>

      <div className="rounded-md border border-danger/30 bg-card p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-danger-foreground">
          <AlertTriangle className="size-4" aria-hidden="true" />
          Danger zone
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Deleting a cadence permanently removes its steps, enrollments, and
          execution history. Cadences with active enrollments cannot be
          deleted; archive them first.
        </p>
        {!confirmDelete ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="mt-3"
            onClick={() => setConfirmDelete(true)}
            disabled={pending || activeEnrollmentCount > 0}
            title={
              activeEnrollmentCount > 0
                ? 'Archive the cadence first to exit active enrollments.'
                : undefined
            }
          >
            <Trash2 className="size-4" aria-hidden="true" />
            <span>Delete cadence</span>
          </Button>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-sm">
              Are you sure? This action cannot be undone.
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmDelete(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={runDelete}
              disabled={pending}
            >
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  <span>Deleting…</span>
                </>
              ) : (
                <span>Yes, delete</span>
              )}
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}
