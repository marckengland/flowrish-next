'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { createCadence } from '@/server/actions/cadences'
import type {
  CadenceListItem,
  CadenceStatus,
  CadencesPage,
} from '@/hooks/use-cadences'
import { useCadencesQuery } from '@/hooks/use-cadences'

/**
 * Cadence management list.
 *
 * - Filters by status (All / Draft / Active / Archived).
 * - Shows per-cadence metrics (step count, enrollment count).
 * - For each cadence the enrollment count is the total across all statuses;
 *   the per-status breakdown is shown on the cadence detail page where a
 *   richer analytics surface exists.
 * - "New cadence" inline form calls `createCadence` Server Action and
 *   navigates to the new detail page on success so the user can add steps.
 *
 * Validates: Requirements 6.1, 32.1, 32.5
 */

export interface CadenceListProps {
  initialData: CadencesPage
  canManage: boolean
}

type StatusFilter = 'ALL' | CadenceStatus

const STATUS_FILTERS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'ARCHIVED', label: 'Archived' },
]

export function CadenceList({
  initialData,
  canManage,
}: CadenceListProps): React.JSX.Element {
  const [filter, setFilter] = useState<StatusFilter>('ALL')
  const [creating, setCreating] = useState(false)

  const query = useCadencesQuery(
    { status: filter, page: 1, pageSize: 50 },
    filter === 'ALL' ? initialData : undefined,
  )
  const page = query.data ?? initialData
  const cadences = page.data

  return (
    <section aria-label="Cadences" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Filter cadences by status"
          className="flex flex-wrap gap-1"
        >
          {STATUS_FILTERS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={filter === opt.value}
              onClick={() => setFilter(opt.value)}
              className={cn(
                'rounded-md border px-3 py-1 text-sm font-medium transition-colors',
                filter === opt.value
                  ? 'border-border bg-card text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {canManage && !creating && (
          <Button
            type="button"
            size="sm"
            onClick={() => setCreating(true)}
          >
            <Plus className="size-4" aria-hidden="true" />
            <span>New cadence</span>
          </Button>
        )}
      </div>

      {creating ? (
        <CreateCadenceForm onDone={() => setCreating(false)} />
      ) : null}

      {query.isError ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {query.error instanceof Error
            ? query.error.message
            : 'Failed to load cadences.'}
        </p>
      ) : cadences.length === 0 ? (
        <EmptyState canManage={canManage} onCreate={() => setCreating(true)} />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {cadences.map((cadence) => (
            <li key={cadence.id}>
              <CadenceCard cadence={cadence} />
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground" aria-live="polite">
        Showing {cadences.length} of {page.pagination.total} cadence
        {page.pagination.total === 1 ? '' : 's'}
      </p>
    </section>
  )
}

function CadenceCard({
  cadence,
}: {
  cadence: CadenceListItem
}): React.JSX.Element {
  const stepCount = cadence.steps.length
  const enrollmentCount = cadence._count.enrollments
  return (
    <Link
      href={`/cadences/${cadence.id}`}
      className="group flex flex-col gap-2 rounded-md border bg-card p-4 transition-colors hover:border-foreground/30"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="line-clamp-2 text-sm font-semibold tracking-tight text-foreground">
          {cadence.name}
        </h3>
        <StatusBadge status={cadence.status} />
      </div>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <MetricCell label="Steps" value={stepCount} />
        <MetricCell label="Enrolled" value={enrollmentCount} />
      </dl>
      <p className="text-xs text-muted-foreground">
        Created {new Date(cadence.createdAt).toLocaleDateString()}
      </p>
    </Link>
  )
}

function MetricCell({
  label,
  value,
}: {
  label: string
  value: number
}): React.JSX.Element {
  return (
    <div className="rounded-md border bg-background px-2 py-1.5">
      <dt className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

export function StatusBadge({
  status,
}: {
  status: CadenceStatus
}): React.JSX.Element {
  const tone = useMemo(() => {
    switch (status) {
      case 'DRAFT':
        return 'bg-muted text-muted-foreground'
      case 'ACTIVE':
        return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
      case 'ARCHIVED':
        return 'bg-slate-500/10 text-slate-700 dark:text-slate-300'
    }
  }, [status])
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        tone,
      )}
    >
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  )
}

function EmptyState({
  canManage,
  onCreate,
}: {
  canManage: boolean
  onCreate: () => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-start gap-2 rounded-md border border-dashed bg-card px-6 py-10">
      <h3 className="text-lg font-semibold">No cadences yet</h3>
      <p className="text-sm text-muted-foreground">
        Cadences coordinate multi-step outreach. Create one to sequence emails,
        calls, and tasks for your leads.
      </p>
      {canManage ? (
        <Button type="button" size="sm" onClick={onCreate} className="mt-2">
          <Plus className="size-4" aria-hidden="true" />
          <span>Create cadence</span>
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">
          You don&apos;t have permission to manage cadences.
        </p>
      )}
    </div>
  )
}

// ─── Create form ─────────────────────────────────────────────────────────────

function CreateCadenceForm({
  onDone,
}: {
  onDone: () => void
}): React.JSX.Element {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    setError(null)
    const form = event.currentTarget
    const formData = new FormData(form)
    startTransition(async () => {
      const result = await createCadence(formData)
      if (result && 'error' in result && result.error) {
        setError(result.error)
        return
      }
      if (result && 'data' in result && result.data) {
        const cadence = result.data as { id: string }
        router.push(`/cadences/${cadence.id}`)
        return
      }
      onDone()
      router.refresh()
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-md border bg-card p-4"
      aria-busy={pending || undefined}
    >
      <div>
        <label
          htmlFor="cadence-name"
          className="block text-xs font-medium text-foreground mb-1"
        >
          Cadence name
        </label>
        <input
          id="cadence-name"
          name="name"
          type="text"
          required
          placeholder="e.g. SMB Outbound"
          className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div>
        <label
          htmlFor="cadence-description"
          className="block text-xs font-medium text-foreground mb-1"
        >
          Description (optional)
        </label>
        <textarea
          id="cadence-description"
          name="description"
          rows={2}
          placeholder="What is this cadence for?"
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
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
          onClick={onDone}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              <span>Creating…</span>
            </>
          ) : (
            <span>Create cadence</span>
          )}
        </Button>
      </div>
    </form>
  )
}
