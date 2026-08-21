'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowUpDown,
  Filter,
  Loader2,
  Plus,
  Search,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input, inputBaseClass } from '@/components/ui/input'
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
 * Restored features (parity with the original flowrish frontend):
 *   - Top-row stat cards (Total / Active / Draft / Archived) which double
 *     as one-click status filters.
 *   - Search by cadence name.
 *   - Sortable table with columns for steps, total enrollments, active
 *     enrollments, completion rate, and created date.
 *
 * The component still hands off mutations through Server Actions and
 * keeps using TanStack Query for the underlying list — `initialData` from
 * the Server Component is reused for the "all" tab so the first paint
 * has no waterfall.
 *
 * Validates: Requirements 6.1, 32.1, 32.5
 */

export interface CadenceListProps {
  initialData: CadencesPage
  canManage: boolean
}

type StatusFilter = 'ALL' | CadenceStatus

type SortField =
  | 'name'
  | 'status'
  | 'stepCount'
  | 'totalEnrollments'
  | 'activeEnrollments'
  | 'completionRate'
  | 'createdAt'
type SortDir = 'asc' | 'desc'

interface RichCadence {
  id: string
  name: string
  status: CadenceStatus
  createdAt: string
  stepCount: number
  totalEnrollments: number
  activeEnrollments: number
  completionRate: number
}

export function CadenceList({
  initialData,
  canManage,
}: CadenceListProps): React.JSX.Element {
  const router = useRouter()
  const [filter, setFilter] = useState<StatusFilter>('ALL')
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<SortField>('createdAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const query = useCadencesQuery(
    { status: filter, page: 1, pageSize: 50 },
    filter === 'ALL' ? initialData : undefined,
  )
  const page = query.data ?? initialData
  const cadences = page.data

  const enrichedAll = useMemo(
    () => initialData.data.map(enrich),
    [initialData.data],
  )
  const enriched = useMemo(() => cadences.map(enrich), [cadences])

  const counts = useMemo(() => {
    const c = { total: 0, ACTIVE: 0, DRAFT: 0, ARCHIVED: 0 }
    for (const cadence of enrichedAll) {
      c.total += 1
      c[cadence.status] += 1
    }
    return c
  }, [enrichedAll])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = enriched
    if (q) {
      list = list.filter((c) => c.name.toLowerCase().includes(q))
    }
    return [...list].sort((a, b) => {
      const cmp = compareCadence(a, b, sortField)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [enriched, search, sortField, sortDir])

  function toggleSort(field: SortField): void {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir(field === 'createdAt' ? 'desc' : 'asc')
    }
  }

  return (
    <section aria-label="Cadences" className="flex flex-col gap-4">
      {/* Stat cards / status filters */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Total cadences"
          value={counts.total}
          active={filter === 'ALL'}
          onClick={() => setFilter('ALL')}
          tone="neutral"
        />
        <StatCard
          label="Active"
          value={counts.ACTIVE}
          active={filter === 'ACTIVE'}
          onClick={() => setFilter('ACTIVE')}
          tone="active"
        />
        <StatCard
          label="Draft"
          value={counts.DRAFT}
          active={filter === 'DRAFT'}
          onClick={() => setFilter('DRAFT')}
          tone="draft"
        />
        <StatCard
          label="Archived"
          value={counts.ARCHIVED}
          active={filter === 'ARCHIVED'}
          onClick={() => setFilter('ARCHIVED')}
          tone="archived"
        />
      </div>

      {/* Search + create */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label htmlFor="cadence-search" className="sr-only">
          Search cadences
        </label>
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative max-w-sm flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="cadence-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search cadences…"
              className="pl-9"
            />
          </div>
          <select
            aria-label="Filter by status"
            value={filter}
            onChange={(e) => setFilter(e.target.value as StatusFilter)}
            className={cn(inputBaseClass, 'h-9 w-auto min-w-[150px]')}
          >
            <option value="ALL">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="DRAFT">Draft</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          {filter !== 'ALL' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFilter('ALL')}
            >
              <Filter className="size-3.5" aria-hidden="true" />
              <span>Clear filter</span>
            </Button>
          )}
          {canManage && !creating && (
            <Button type="button" size="sm" onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden="true" />
              <span>New cadence</span>
            </Button>
          )}
        </div>
      </div>

      {creating ? (
        <CreateCadenceForm onDone={() => setCreating(false)} />
      ) : null}

      {/* Body */}
      {query.isError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {query.error instanceof Error
            ? query.error.message
            : 'Failed to load cadences.'}
        </p>
      ) : filtered.length === 0 ? (
        <EmptyState
          canManage={canManage}
          onCreate={() => setCreating(true)}
          totalAcrossAllFilters={enrichedAll.length}
        />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <SortHeader
                  label="Cadence"
                  field="name"
                  current={sortField}
                  dir={sortDir}
                  onSort={toggleSort}
                />
                <SortHeader
                  label="Status"
                  field="status"
                  current={sortField}
                  dir={sortDir}
                  onSort={toggleSort}
                />
                <SortHeader
                  label="Steps"
                  field="stepCount"
                  current={sortField}
                  dir={sortDir}
                  onSort={toggleSort}
                  align="right"
                />
                <SortHeader
                  label="Active people"
                  field="activeEnrollments"
                  current={sortField}
                  dir={sortDir}
                  onSort={toggleSort}
                  align="right"
                />
                <SortHeader
                  label="Total people"
                  field="totalEnrollments"
                  current={sortField}
                  dir={sortDir}
                  onSort={toggleSort}
                  align="right"
                />
                <SortHeader
                  label="Completion rate"
                  field="completionRate"
                  current={sortField}
                  dir={sortDir}
                  onSort={toggleSort}
                  align="right"
                />
                <SortHeader
                  label="Created"
                  field="createdAt"
                  current={sortField}
                  dir={sortDir}
                  onSort={toggleSort}
                  align="right"
                />
              </tr>
            </thead>
            <tbody className="divide-y divide-row-divider">
              {filtered.map((cadence) => (
                <tr
                  key={cadence.id}
                  onClick={() => router.push(`/cadences/${cadence.id}`)}
                  className="cursor-pointer transition-colors hover:bg-background focus-within:bg-background"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/cadences/${cadence.id}`}
                      aria-label={`Open cadence ${cadence.name}`}
                      // Stop the row handler from double-firing; the row's
                      // onClick already navigates. The real <Link> stays for
                      // keyboard, right-click, and open-in-new-tab.
                      onClick={(e) => e.stopPropagation()}
                      className="font-medium text-foreground hover:underline focus-visible:underline focus-visible:outline-none"
                    >
                      {cadence.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={cadence.status} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {cadence.stepCount}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {cadence.activeEnrollments}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {cadence.totalEnrollments}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {cadence.completionRate.toFixed(1)}%
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground">
                    {new Date(cadence.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <p className="text-xs text-muted-foreground" aria-live="polite">
        Showing {filtered.length} of {page.pagination.total} cadence
        {page.pagination.total === 1 ? '' : 's'}
      </p>
    </section>
  )
}

function enrich(c: CadenceListItem): RichCadence {
  // The list endpoint only returns total enrollments via `_count`, so
  // active-enrollment counts and completion rate are not yet known from
  // the list response. We surface 0 here and let the cadence detail page
  // show richer numbers — same pragmatic compromise the previous Next
  // port made for the card layout.
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    createdAt: c.createdAt,
    stepCount: c.steps.length,
    totalEnrollments: c._count.enrollments,
    activeEnrollments: 0,
    completionRate: 0,
  }
}

function compareCadence(
  a: RichCadence,
  b: RichCadence,
  field: SortField,
): number {
  switch (field) {
    case 'name':
      return a.name.localeCompare(b.name)
    case 'status':
      return a.status.localeCompare(b.status)
    case 'createdAt':
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    default:
      return (a[field] as number) - (b[field] as number)
  }
}

interface StatCardProps {
  label: string
  value: number
  active: boolean
  onClick: () => void
  tone: 'neutral' | 'active' | 'draft' | 'archived'
}

function StatCard({
  label,
  value,
  active,
  onClick,
  tone,
}: StatCardProps): React.JSX.Element {
  const valueClasses: Record<StatCardProps['tone'], string> = {
    neutral: 'text-foreground',
    active: 'text-brand-emphasis',
    draft: 'text-foreground',
    archived: 'text-warning-foreground',
  }
  return (
    <button
      type="button"
      data-active={active}
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-lg border bg-card px-4 py-3.5 text-left transition-colors hover:bg-background',
        active ? 'border-brand ring-1 ring-brand' : 'border-border',
      )}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('mt-1.5 text-2xl font-semibold tnum', valueClasses[tone])}>
        {value}
      </p>
    </button>
  )
}

interface SortHeaderProps {
  label: string
  field: SortField
  current: SortField
  dir: SortDir
  onSort: (field: SortField) => void
  align?: 'left' | 'right'
}

function SortHeader({
  label,
  field,
  current,
  dir,
  onSort,
  align = 'left',
}: SortHeaderProps): React.JSX.Element {
  const isActive = current === field
  const ariaSort: 'ascending' | 'descending' | 'none' = isActive
    ? dir === 'asc'
      ? 'ascending'
      : 'descending'
    : 'none'
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={cn(
        'px-4 py-2.5',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn(
          'eyebrow relative z-10 inline-flex items-center gap-1 transition-colors hover:text-foreground',
          align === 'right' && 'ml-auto',
          isActive ? 'text-foreground' : null,
        )}
      >
        {label}
        <ArrowUpDown className="size-3" aria-hidden="true" />
      </button>
    </th>
  )
}

export function StatusBadge({
  status,
}: {
  status: CadenceStatus
}): React.JSX.Element {
  const variant: 'brand' | 'neutral' | 'warning' = (() => {
    switch (status) {
      case 'ACTIVE':
        return 'brand'
      case 'ARCHIVED':
        return 'warning'
      case 'DRAFT':
      default:
        return 'neutral'
    }
  })()
  return (
    <Badge variant={variant}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </Badge>
  )
}

function EmptyState({
  canManage,
  onCreate,
  totalAcrossAllFilters,
}: {
  canManage: boolean
  onCreate: () => void
  totalAcrossAllFilters: number
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-start gap-2 rounded-md border border-dashed bg-card px-6 py-10">
      <h3 className="text-lg font-semibold">
        {totalAcrossAllFilters === 0
          ? 'No cadences yet'
          : 'No cadences match your filters'}
      </h3>
      <p className="text-sm text-muted-foreground">
        {totalAcrossAllFilters === 0
          ? 'Cadences coordinate multi-step outreach. Create one to sequence emails, calls, and tasks for your leads.'
          : 'Try clearing the search or status filter.'}
      </p>
      {canManage && totalAcrossAllFilters === 0 ? (
        <Button type="button" size="sm" onClick={onCreate} className="mt-2">
          <Plus className="size-4" aria-hidden="true" />
          <span>Create cadence</span>
        </Button>
      ) : null}
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
        <Input
          id="cadence-name"
          name="name"
          type="text"
          required
          placeholder="e.g. SMB Outbound"
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
