'use client'

export interface DateRangeFilterProps {
  startDate: string
  endDate: string
  onStartDateChange: (value: string) => void
  onEndDateChange: (value: string) => void
  /** Optional callback for the "Clear" button — only rendered when at
   * least one of `startDate` / `endDate` is set. */
  onClear?: () => void
  /** Optional extra class for the wrapper. */
  className?: string
}

/**
 * Reusable "From / To" date filter for dashboard widgets. Both inputs
 * are uncontrolled-from-the-parent's-perspective only in that we
 * forward `onChange`; the parent owns the canonical state so multiple
 * widgets can share the same range without re-fetching from URL state.
 *
 * Inputs use the native `<input type="date">` so users get the
 * platform's native date picker (no extra dependency, no a11y debt).
 */
export function DateRangeFilter({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  onClear,
  className,
}: DateRangeFilterProps): React.JSX.Element {
  const inputClass =
    'h-8 rounded-lg border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

  const isFiltered = Boolean(startDate || endDate)

  return (
    <div
      className={`flex flex-wrap items-center gap-2 ${className ?? ''}`.trim()}
    >
      <label
        htmlFor="date-range-from"
        className="text-sm text-muted-foreground"
      >
        From
      </label>
      <input
        id="date-range-from"
        type="date"
        value={startDate}
        max={endDate || undefined}
        onChange={(e) => onStartDateChange(e.target.value)}
        className={inputClass}
        aria-label="Start date"
      />
      <label htmlFor="date-range-to" className="text-sm text-muted-foreground">
        To
      </label>
      <input
        id="date-range-to"
        type="date"
        value={endDate}
        min={startDate || undefined}
        onChange={(e) => onEndDateChange(e.target.value)}
        className={inputClass}
        aria-label="End date"
      />
      {isFiltered && onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
        >
          Clear
        </button>
      ) : null}
    </div>
  )
}
