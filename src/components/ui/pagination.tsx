import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'

export interface PaginationMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface PaginationProps {
  pagination: PaginationMeta
  /** Called with the new (1-based) page number. */
  onPageChange: (page: number) => void
  /** Plural noun for the count line, e.g. "leads". */
  itemLabel?: string
  /** Reflects an in-flight fetch so the controls disable during navigation. */
  loading?: boolean
}

/**
 * List pagination control: a "showing X–Y of N" summary on the left and
 * prev/next buttons with a page indicator on the right. Rendered by the list
 * tables, which own the `page` state and pass it to their query.
 *
 * The arrows only appear once there is more than one page; the summary line
 * is always shown (when there are rows) so the count stays visible.
 */
export function Pagination({
  pagination,
  onPageChange,
  itemLabel = 'items',
  loading = false,
}: PaginationProps): React.JSX.Element | null {
  const { page, pageSize, total, totalPages } = pagination
  if (total === 0) return null

  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  const multiPage = totalPages > 1

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-0.5">
      <p className="eyebrow" aria-live="polite">
        Showing {from}
        {to > from ? `–${to}` : ''} of {total} {itemLabel}
      </p>

      {multiPage ? (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            disabled={loading || page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <span className="tnum text-[13px] text-muted-foreground" aria-live="polite">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={loading || page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            aria-label="Next page"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </div>
  )
}
