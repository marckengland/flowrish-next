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
  /** When provided, renders a keyboard-accessible rows-per-page selector. */
  onPageSizeChange?: (pageSize: number) => void
  /** Options offered by the page-size selector. */
  pageSizeOptions?: readonly number[]
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
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50, 100],
}: PaginationProps): React.JSX.Element | null {
  const { page, pageSize, total, totalPages } = pagination
  if (total === 0) return null

  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  const multiPage = totalPages > 1

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-0.5">
      <div className="flex items-center gap-3">
        <p className="eyebrow" aria-live="polite">
          Showing {from}
          {to > from ? `–${to}` : ''} of {total} {itemLabel}
        </p>
        {onPageSizeChange ? (
          <label className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <span className="sr-only">Rows per page</span>
            <select
              value={pageSize}
              disabled={loading}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              aria-label="Rows per page"
              className="h-7 rounded-md border border-input bg-card px-1.5 text-[12.5px] text-foreground transition-[border-color,box-shadow] focus-visible:border-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/15 disabled:opacity-50"
            >
              {pageSizeOptions.map((o) => (
                <option key={o} value={o}>
                  {o} / page
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

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
