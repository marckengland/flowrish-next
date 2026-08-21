import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableHead, Th, TableBody } from '@/components/ui/table'

/**
 * Loading placeholder for the list pages (leads, companies, contacts …).
 * Mirrors the real layout — page title, a filter/search bar, then a bordered
 * table — so navigation fills in smoothly instead of flashing a spinner.
 *
 * Rendered by each route's `loading.tsx`. The wrapper carries
 * `aria-busy`/`role="status"` so assistive tech announces the load once
 * rather than reading every placeholder bar.
 */
export function ListPageSkeleton({
  columns = 6,
  rows = 8,
  minWidth = 720,
}: {
  columns?: number
  rows?: number
  minWidth?: number
}): React.JSX.Element {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className="flex flex-col gap-5"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-28 rounded-[10px]" />
      </div>

      {/* Filter bar */}
      <Skeleton className="h-10 w-full max-w-[320px] rounded-[10px]" />

      {/* Table */}
      <Table minWidth={minWidth}>
        <TableHead>
          {Array.from({ length: columns }).map((_, i) => (
            <Th key={i}>
              <Skeleton className="h-3 w-16" />
            </Th>
          ))}
        </TableHead>
        <TableBody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r} className="border-b border-row-divider last:border-0">
              {Array.from({ length: columns }).map((_, c) => (
                <td key={c} className="px-4 py-3">
                  <Skeleton className={c === 0 ? 'h-4 w-36' : 'h-4 w-20'} />
                </td>
              ))}
            </tr>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
