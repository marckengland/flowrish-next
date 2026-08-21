'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ScrollText, Filter, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Pagination } from '@/components/ui/pagination'
import { Table, TableHead, Th, SortableTh, TableBody, Tr, Td } from '@/components/ui/table'
import { sortByKey, type SortDir } from '@/lib/table-sort'

/**
 * Maps an audit action verb to a semantic Badge tone:
 * CREATE / ENROLL = brand, UPDATE = warning, DELETE = danger.
 */
function actionVariant(action: string): NonNullable<BadgeProps['variant']> {
  switch (action.toUpperCase()) {
    case 'CREATE':
    case 'ENROLL':
    case 'IMPORT':
      return 'brand'
    case 'UPDATE':
    case 'EXPORT':
      return 'warning'
    case 'DELETE':
      return 'danger'
    default:
      return 'neutral'
  }
}

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

type AuditSortKey = 'action' | 'entity' | 'when'

function auditSortValue(entry: AuditEntry, key: AuditSortKey): string {
  switch (key) {
    case 'action':
      return entry.action
    case 'entity':
      return entry.entityType
    case 'when':
      return entry.createdAt
  }
}

export function AuditLog(): React.JSX.Element {
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState<AuditFilters>({
    entityType: '',
    userId: '',
    fromDate: '',
    toDate: '',
  })
  const [showFilters, setShowFilters] = useState(false)
  const [sortKey, setSortKey] = useState<AuditSortKey>('when')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  function toggleSort(key: string): void {
    const next = key as AuditSortKey
    if (next === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(next)
    setSortDir(next === 'when' ? 'desc' : 'asc')
  }

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
      return (await res.json()).data
    },
  })

  const handleFilterChange = (key: keyof AuditFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
    setPage(1)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Audit log</h2>
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
          className="grid grid-cols-1 gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4"
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
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border bg-card py-12">
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
          <Table minWidth={640}>
            <TableHead>
              <SortableTh label="Action" sortKey="action" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortableTh label="Entity" sortKey="entity" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <Th>Entity ID</Th>
              <Th>Actor</Th>
              <SortableTh label="When" sortKey="when" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
            </TableHead>
            <TableBody>
              {sortByKey(data.entries, (e) => auditSortValue(e, sortKey), sortDir).map((entry) => (
                <Tr key={entry.id}>
                  <Td>
                    <Badge
                      variant={actionVariant(entry.action)}
                      size="sm"
                      className="rounded-[5px] font-mono font-semibold"
                    >
                      {entry.action}
                    </Badge>
                  </Td>
                  <Td className="text-foreground">{entry.entityType}</Td>
                  <Td className="font-mono text-xs text-muted-foreground">
                    {entry.entityId.slice(0, 8)}...
                  </Td>
                  <Td className="font-mono text-xs text-muted-foreground">
                    {entry.userId.slice(0, 8)}...
                  </Td>
                  <Td align="right" className="font-mono text-muted-foreground">
                    {new Date(entry.createdAt).toLocaleString()}
                  </Td>
                </Tr>
              ))}
            </TableBody>
          </Table>

          <Pagination
            pagination={data.pagination}
            onPageChange={setPage}
            itemLabel="entries"
            loading={isLoading}
          />
        </>
      )}
    </div>
  )
}
