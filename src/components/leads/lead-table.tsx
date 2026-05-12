'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowUp, ArrowUpDown, Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'
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

  const query = useLeadsQuery({ filters, page, pageSize })
  const leadsPage = query.data ?? initialData
  const rows = leadsPage?.data ?? []

  const sorted = useMemo(
    () => sortLeads(rows, sortKey, sortDir),
    [rows, sortKey, sortDir],
  )

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

      <div className="overflow-x-auto rounded-md border bg-card">
        <table className="w-full min-w-[880px] text-sm">
          <thead className="bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
              <th scope="col" className="px-3 py-2 font-medium">
                Stage
              </th>
              <SortableHeader
                label="Status"
                sortKey="leadStatus"
                activeKey={sortKey}
                dir={sortDir}
                onSort={toggleSort}
              />
              <SortableHeader
                label="Deal Value"
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
                label="Last Activity"
                sortKey="lastActivityAt"
                activeKey={sortKey}
                dir={sortDir}
                onSort={toggleSort}
              />
              <th scope="col" className="px-3 py-2 font-medium">
                Assignee
              </th>
            </tr>
          </thead>
          <tbody>
            {query.isError ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-8 text-center text-sm text-destructive"
                  role="alert"
                >
                  Couldn&apos;t load leads.{' '}
                  {query.error instanceof Error ? query.error.message : ''}
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-8 text-center text-sm text-muted-foreground"
                >
                  No leads match the current filters.
                </td>
              </tr>
            ) : (
              sorted.map((lead) => (
                <tr
                  key={lead.id}
                  className="border-t transition-colors hover:bg-muted/30"
                >
                  <td className="px-3 py-2 font-medium">
                    <Link
                      href={`/leads/${lead.id}`}
                      className="text-foreground hover:underline focus-visible:underline"
                    >
                      {fullName(lead)}
                    </Link>
                    {lead.email && (
                      <div className="text-xs text-muted-foreground">
                        {lead.email}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {lead.companyName ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                      {lead.stage?.name ?? '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {prettyStatus(lead.leadStatus)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrency(lead.dealValue, lead.currency)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {lead.score}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {formatRelative(lead.lastActivityAt)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {lead.assignedUser?.name ?? 'Unassigned'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {leadsPage?.pagination && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
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
        'px-3 py-2 font-medium',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'inline-flex items-center gap-1 rounded-sm outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40',
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

function prettyStatus(status: string): string {
  return status.charAt(0) + status.slice(1).toLowerCase()
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
