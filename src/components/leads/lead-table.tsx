'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowUp, ArrowUpDown, Loader2, Target } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { ScoreBadge } from '@/components/scoring/score-badge'
import { TableState } from '@/components/ui/table'
import { useFiltersStore } from '@/stores/filters'
import { useLeadsQuery, type LeadListItem } from '@/hooks/use-leads'

/**
 * Columns supported by client-side sorting. Server pagination is keyed
 * on createdAt desc today (see leads service `getLeads`); this table
 * lets the user re-sort the current page in the client without a round
 * trip, which is consistent with how small lists behave in other CRMs.
 */
type SortKey =
  | 'name'
  | 'companyName'
  | 'leadStatus'
  | 'dealValue'
  | 'score'
  | 'lastActivityAt'
  | 'createdAt'

type SortDir = 'asc' | 'desc'

export interface LeadTableProps {
  /** Initial data rendered server-side, used as the TanStack Query initial cache. */
  initialData?: {
    data: LeadListItem[]
    pagination: {
      page: number
      pageSize: number
      total: number
      totalPages: number
    }
  }
  /** Default page to request. */
  page?: number
  /** Default page size to request. */
  pageSize?: number
}

/**
 * Data table for the leads list page.
 *
 * - Reads filter state from the Zustand `filters` store so it stays in sync
 *   with the filter panel
 * - Fetches data via TanStack Query (`useLeadsQuery`) keyed on filters
 * - Supports client-side column sorting on the currently-loaded page
 * - Links each row to `/leads/[id]` so the detail page (task 22.2) can take
 *   over from here
 *
 * Validates: Requirements 4.4, 4.6
 */
export function LeadTable({
  initialData,
  page = 1,
  pageSize = 20,
}: LeadTableProps): React.JSX.Element {
  const filters = useFiltersStore((s) => s.leads)
  const [sortKey, setSortKey] = useState<SortKey>('createdAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Only seed the query with SSR data when the view matches what the server
  // pre-rendered (default filters, first page). For any other filter/page the
  // seed wouldn't match the query key and would show wrong rows.
  const isDefaultView =
    Object.keys(filters).length === 0 && page === 1 && pageSize === 20

  const query = useLeadsQuery(
    { filters, page, pageSize },
    isDefaultView ? initialData : undefined,
  )
  const leadsPage = query.data ?? initialData

  const sorted = useMemo(() => {
    const rows = leadsPage?.data ?? []
    return sortLeads(rows, sortKey, sortDir)
  }, [leadsPage, sortKey, sortDir])

  function toggleSort(nextKey: SortKey): void {
    if (nextKey === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(nextKey)
    setSortDir(nextKey === 'createdAt' || nextKey === 'lastActivityAt' ? 'desc' : 'asc')
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        role="status"
        aria-live="polite"
        className={cn(
          'flex items-center gap-2 text-xs text-muted-foreground',
          query.isFetching ? 'opacity-100' : 'opacity-0',
        )}
      >
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        <span>Updating…</span>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b bg-muted/40 text-left">
            <tr>
              <SortableHeader
                label="Name"
                sortKey="name"
                activeKey={sortKey}
                dir={sortDir}
                onSort={toggleSort}
              />
              <SortableHeader
                label="Company"
                sortKey="companyName"
                activeKey={sortKey}
                dir={sortDir}
                onSort={toggleSort}
              />
              <th scope="col" className="eyebrow px-4 py-3">
                Stage
              </th>
              <SortableHeader
                label="Deal value"
                sortKey="dealValue"
                activeKey={sortKey}
                dir={sortDir}
                onSort={toggleSort}
                align="right"
              />
              <SortableHeader
                label="Score"
                sortKey="score"
                activeKey={sortKey}
                dir={sortDir}
                onSort={toggleSort}
                align="right"
              />
              <SortableHeader
                label="Last activity"
                sortKey="lastActivityAt"
                activeKey={sortKey}
                dir={sortDir}
                onSort={toggleSort}
              />
              <th scope="col" className="eyebrow px-4 py-3">
                Assignee
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-row-divider">
            {query.isError ? (
              <TableState colSpan={7} tone="error">
                Couldn&apos;t load leads.{' '}
                {query.error instanceof Error ? query.error.message : ''}
              </TableState>
            ) : sorted.length === 0 ? (
              <TableState
                colSpan={7}
                icon={<Target className="size-5" aria-hidden="true" />}
                title="No leads match the current filters"
                description="Adjust or clear your filters, or add a lead to get started."
              />
            ) : (
              sorted.map((lead) => (
                <tr
                  key={lead.id}
                  className="relative cursor-pointer transition-colors hover:bg-background focus-within:bg-background"
                >
                  <td className="px-4 py-3 font-semibold">
                    <Link
                      href={`/leads/${lead.id}`}
                      aria-label={`Open ${fullName(lead)}`}
                      className="text-foreground before:absolute before:inset-0 before:content-[''] hover:underline focus-visible:underline focus-visible:outline-none"
                    >
                      {fullName(lead)}
                    </Link>
                    {lead.email && (
                      <div className="text-xs font-normal text-muted-foreground">
                        {lead.email}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {lead.companyName ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    {lead.stage?.name ? (
                      <Badge variant="neutral" size="md">
                        {lead.stage.name}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="tnum px-4 py-3 text-right font-semibold">
                    {formatCurrency(lead.dealValue, lead.currency)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ScoreBadge score={lead.score} size="md" />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatRelative(lead.lastActivityAt)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {lead.assignedUser?.name ?? 'Unassigned'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {leadsPage?.pagination && (
        <p className="eyebrow px-0.5" aria-live="polite">
          Showing {sorted.length} of {leadsPage.pagination.total} leads
          {leadsPage.pagination.totalPages > 1 && (
            <> · Page {leadsPage.pagination.page} of {leadsPage.pagination.totalPages}</>
          )}
        </p>
      )}
    </div>
  )
}

function SortableHeader({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  align = 'left',
}: {
  label: string
  sortKey: SortKey
  activeKey: SortKey
  dir: SortDir
  onSort: (key: SortKey) => void
  align?: 'left' | 'right'
}): React.JSX.Element {
  const active = activeKey === sortKey
  const ariaSort = active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={cn(
        'eyebrow px-4 py-3',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'inline-flex items-center gap-1 rounded-sm uppercase outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40',
          active && 'text-foreground',
          align === 'right' && 'ml-auto',
        )}
      >
        <span>{label}</span>
        {active ? (
          dir === 'asc' ? (
            <ArrowUp className="size-3" aria-hidden="true" />
          ) : (
            <ArrowDown className="size-3" aria-hidden="true" />
          )
        ) : (
          <ArrowUpDown className="size-3 opacity-60" aria-hidden="true" />
        )}
      </button>
    </th>
  )
}

function fullName(lead: LeadListItem): string {
  const parts = [lead.firstName, lead.lastName].filter(Boolean)
  return parts.join(' ').trim() || 'Unnamed lead'
}

function formatCurrency(
  value: string | number | null | undefined,
  currency: string,
): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return '—'
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(n)
  } catch {
    return `${currency} ${n}`
  }
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const diffMs = Date.now() - d.getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return d.toLocaleDateString()
}

/**
 * Pure sorter exported for test coverage. Uses Intl.Collator for string
 * comparisons so sorting is locale-aware and stable when values tie.
 */
export function sortLeads(
  rows: readonly LeadListItem[],
  key: SortKey,
  dir: SortDir,
): LeadListItem[] {
  const collator = new Intl.Collator(undefined, {
    sensitivity: 'base',
    numeric: true,
  })
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => sign * compareBy(a, b, key, collator))
}

function compareBy(
  a: LeadListItem,
  b: LeadListItem,
  key: SortKey,
  collator: Intl.Collator,
): number {
  switch (key) {
    case 'name': {
      return collator.compare(fullName(a), fullName(b))
    }
    case 'companyName': {
      return collator.compare(a.companyName ?? '', b.companyName ?? '')
    }
    case 'leadStatus': {
      return collator.compare(a.leadStatus, b.leadStatus)
    }
    case 'dealValue': {
      return numericCompare(a.dealValue, b.dealValue)
    }
    case 'score': {
      return a.score - b.score
    }
    case 'lastActivityAt': {
      return dateCompare(a.lastActivityAt, b.lastActivityAt)
    }
    case 'createdAt': {
      return dateCompare(a.createdAt, b.createdAt)
    }
  }
}

function numericCompare(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
): number {
  const toNum = (v: string | number | null | undefined): number =>
    v === null || v === undefined || v === ''
      ? Number.NEGATIVE_INFINITY
      : typeof v === 'number'
        ? v
        : Number(v)
  const na = toNum(a)
  const nb = toNum(b)
  if (Number.isNaN(na) && Number.isNaN(nb)) return 0
  if (Number.isNaN(na)) return -1
  if (Number.isNaN(nb)) return 1
  return na - nb
}

function dateCompare(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const ta = a ? new Date(a).getTime() : Number.NEGATIVE_INFINITY
  const tb = b ? new Date(b).getTime() : Number.NEGATIVE_INFINITY
  return ta - tb
}
