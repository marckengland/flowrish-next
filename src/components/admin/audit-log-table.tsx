'use client'

import { useQuery } from '@tanstack/react-query'
import { ScrollText } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * Compact audit log table scoped to a specific entity (lead, cadence,
 * etc.). Designed for embedding inside detail pages — no filters, no
 * pagination controls, just the most recent activity.
 *
 * The full filterable audit experience lives in `AuditLog`
 * (`components/admin/audit-log.tsx`); this is the inline counterpart.
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

export interface AuditLogTableProps {
  entityType: string
  entityId: string
  /** Maximum entries to display. Defaults to 25. */
  pageSize?: number
  /** Optional extra class for the wrapper. */
  className?: string
}

const ACTION_TONE: Record<string, string> = {
  CREATE: 'bg-brand-subtle text-brand-emphasis',
  UPDATE: 'bg-warning-subtle text-warning-foreground',
  DELETE: 'bg-danger-subtle text-danger-foreground',
  LOGIN: 'bg-muted text-muted-foreground',
  LOGOUT: 'bg-muted text-muted-foreground',
  EXPORT: 'bg-warning-subtle text-warning-foreground',
  IMPORT: 'bg-brand-subtle text-brand-emphasis',
}

export function AuditLogTable({
  entityType,
  entityId,
  pageSize = 25,
  className,
}: AuditLogTableProps): React.JSX.Element {
  const params = new URLSearchParams({
    entityType,
    entityId,
    pageSize: String(pageSize),
  })

  const { data, isLoading, isError, error } = useQuery<AuditLogResponse>({
    queryKey: ['audit-log', 'entity', entityType, entityId, pageSize],
    queryFn: async () => {
      const res = await fetch(`/api/admin/audit?${params.toString()}`)
      if (!res.ok) {
        throw new Error('Failed to load audit history')
      }
      return (await res.json()).data
    },
  })

  if (isLoading) {
    return (
      <p className={cn('text-sm text-muted-foreground', className)}>
        Loading audit history…
      </p>
    )
  }

  if (isError) {
    return (
      <p className={cn('text-sm text-danger-foreground', className)} role="alert">
        {error instanceof Error ? error.message : 'Failed to load audit history.'}
      </p>
    )
  }

  const entries = data?.entries ?? []

  if (entries.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col items-center gap-2 rounded-md border border-dashed bg-muted/20 p-6 text-sm text-muted-foreground',
          className,
        )}
      >
        <ScrollText className="size-5" aria-hidden="true" />
        <p>No audit entries yet for this {entityType.toLowerCase()}.</p>
      </div>
    )
  }

  return (
    <ul className={cn('flex flex-col divide-y rounded-md border', className)}>
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="flex items-start justify-between gap-3 px-3 py-2"
        >
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <span
              className={cn(
                'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                ACTION_TONE[entry.action] ?? 'bg-muted text-muted-foreground',
              )}
            >
              {entry.action}
            </span>
            <div className="min-w-0">
              <p className="text-xs text-foreground">
                User {entry.userId.slice(0, 8)}…
              </p>
              {entry.changes ? (
                <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-1.5 text-[10px] text-muted-foreground">
                  {formatChanges(entry.changes)}
                </pre>
              ) : null}
            </div>
          </div>
          <time
            dateTime={entry.createdAt}
            className="shrink-0 text-[11px] text-muted-foreground"
            suppressHydrationWarning
          >
            {new Date(entry.createdAt).toLocaleString()}
          </time>
        </li>
      ))}
    </ul>
  )
}

function formatChanges(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
