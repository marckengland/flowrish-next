'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ScrollText, Filter, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * Filterable audit trail component.
 *
 * Displays audit entries with filters for entity type, user, and date range.
 * Shows an empty state when no entries match the current filters.
 *
 * Validates: Requirements 20.3
 */

interface AuditEntry {
  id: string
  userId: string
  action: string
  entityType: string
  entityId: string
  changes: unknown
  createdAt: string
}

interface AuditLogResponse {
  entries: AuditEntry[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

interface AuditFilters {
  entityType: string
  userId: string
  fromDate: string
  toDate: string
}

const ENTITY_TYPES = ['Lead', 'Contact', 'Company', 'Task', 'Cadence', 'Pipeline']
const ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'EXPORT', 'IMPORT']

export function AuditLog(): React.JSX.Element {
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState<AuditFilters>({
    entityType: '',
    userId: '',
    fromDate: '',
    toDate: '',
  })
  const [showFilters, setShowFilters] = useState(false)

  const queryParams = new URLSearchParams()
  queryParams.set('page', String(page))
  queryParams.set('pageSize', '25')
  if (filters.entityType) queryParams.set('entityType', filters.entityType)
  if (filters.userId) queryParams.set('userId', filters.userId)
  if (filters.fromDate) queryParams.set('fromDate', filters.fromDate)
  if (filters.toDate) queryParams.set('toDate', filters.toDate)

  const { data, isLoading } = useQuery<AuditLogResponse>({
    queryKey: ['audit-log', page, filters],
    queryFn: async () => {
      const res = await fetch(`/api/admin/audit?${queryParams.toString()}`)
      if (!res.ok) throw new Error('Failed to fetch audit log')
      return res.json()
    },
  })

  const handleFilterChange = (key: keyof AuditFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
    setPage(1)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ScrollText className="size-5 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-lg font-semibold">Audit Log</h2>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowFilters(!showFilters)}
          aria-expanded={showFilters}
          aria-controls="audit-filters"
        >
          <Filter className="size-4" aria-hidden="true" />
          <span>Filters</span>
        </Button>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div
          id="audit-filters"
          className="grid grid-cols-1 gap-3 rounded-md border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="filter-entity-type" className="text-xs font-medium text-muted-foreground">
              Entity Type
            </label>
            <select
              id="filter-entity-type"
              value={filters.entityType}
              onChange={(e) => handleFilterChange('entityType', e.target.value)}
              className="h-8 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">All types</option>
              {ENTITY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="filter-user" className="text-xs font-medium text-muted-foreground">
              User ID
            </label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                id="filter-user"
                type="text"
                placeholder="Filter by user..."
                value={filters.userId}
                onChange={(e) => handleFilterChange('userId', e.target.value)}
                className="h-8 w-full rounded-md border bg-background pl-7 pr-2 text-sm"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="filter-from" className="text-xs font-medium text-muted-foreground">
              From Date
            </label>
            <input
              id="filter-from"
              type="date"
              value={filters.fromDate}
              onChange={(e) => handleFilterChange('fromDate', e.target.value)}
              className="h-8 rounded-md border bg-background px-2 text-sm"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="filter-to" className="text-xs font-medium text-muted-foreground">
              To Date
            </label>
            <input
              id="filter-to"
              type="date"
              value={filters.toDate}
              onChange={(e) => handleFilterChange('toDate', e.target.value)}
              className="h-8 rounded-md border bg-background px-2 text-sm"
            />
          </div>
        </div>
      )}

      {/* Audit entries */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-sm text-muted-foreground">Loading audit log...</p>
        </div>
      ) : !data || data.entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-md border bg-card py-12">
          <ScrollText className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium text-muted-foreground">No audit entries</p>
          <p className="text-xs text-muted-foreground">
            {filters.entityType || filters.userId || filters.fromDate || filters.toDate
              ? 'No entries match the current filters. Try adjusting your criteria.'
              : 'Audit entries will appear here as actions are performed.'}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Action</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Entity</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Entity ID</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">User</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                        {entry.action}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{entry.entityType}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {entry.entityId.slice(0, 8)}...
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {entry.userId.slice(0, 8)}...
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {data.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Page {data.pagination.page} of {data.pagination.totalPages} ({data.pagination.total} entries)
              </p>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="xs"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={page >= data.pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
