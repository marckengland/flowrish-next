'use client'

import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'

export interface SearchFilters {
  stage: string
  scoreMin: string
  scoreMax: string
  startDate: string
  endDate: string
  assignedTo: string
}

export const emptySearchFilters: SearchFilters = {
  stage: '',
  scoreMin: '',
  scoreMax: '',
  startDate: '',
  endDate: '',
  assignedTo: '',
}

export interface FilterPanelProps {
  filters: SearchFilters
  onChange: (next: SearchFilters) => void
  onClear: () => void
  /** Optional extra class for the wrapper. */
  className?: string
}

/**
 * Filter panel for the search page.
 *
 * Six fields cover stage, score range, date range, and assignee. The
 * panel is purely presentational — the parent owns the filter state
 * and wiring to the search query. A small "Clear filters" affordance
 * appears whenever any field has a value.
 *
 * Validates: Requirements 16.4
 */
export function FilterPanel({
  filters,
  onChange,
  onClear,
  className,
}: FilterPanelProps): React.JSX.Element {
  function set<K extends keyof SearchFilters>(
    key: K,
    value: SearchFilters[K],
  ): void {
    onChange({ ...filters, [key]: value })
  }

  const inputClass =
    'h-9 w-full rounded-[10px] border border-input bg-card px-2.5 text-sm text-foreground outline-none transition-[color,box-shadow,border-color] focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand/15'

  const hasActiveFilters = Object.values(filters).some((v) => v !== '')

  return (
    <div
      className={`rounded-lg border p-4 ${className ?? ''}`.trim()}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Filters</h3>
        {hasActiveFilters && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={onClear}
            aria-label="Clear filters"
          >
            <X className="size-3" aria-hidden="true" />
            <span>Clear filters</span>
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <FilterField
          id="search-filter-stage"
          label="Stage"
          placeholder="e.g. Qualified"
          value={filters.stage}
          onChange={(v) => set('stage', v)}
          inputClass={inputClass}
        />
        <FilterField
          id="search-filter-score-min"
          label="Score min"
          type="number"
          placeholder="0"
          value={filters.scoreMin}
          min={0}
          max={100}
          onChange={(v) => set('scoreMin', v)}
          inputClass={inputClass}
        />
        <FilterField
          id="search-filter-score-max"
          label="Score max"
          type="number"
          placeholder="100"
          value={filters.scoreMax}
          min={0}
          max={100}
          onChange={(v) => set('scoreMax', v)}
          inputClass={inputClass}
        />
        <FilterField
          id="search-filter-start-date"
          label="Start date"
          type="date"
          value={filters.startDate}
          onChange={(v) => set('startDate', v)}
          inputClass={inputClass}
        />
        <FilterField
          id="search-filter-end-date"
          label="End date"
          type="date"
          value={filters.endDate}
          onChange={(v) => set('endDate', v)}
          inputClass={inputClass}
        />
        <FilterField
          id="search-filter-assigned-to"
          label="Assigned to (user ID)"
          placeholder="User ID"
          value={filters.assignedTo}
          onChange={(v) => set('assignedTo', v)}
          inputClass={inputClass}
        />
      </div>
    </div>
  )
}

interface FilterFieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  inputClass: string
  type?: 'text' | 'number' | 'date'
  placeholder?: string
  min?: number
  max?: number
}

function FilterField({
  id,
  label,
  value,
  onChange,
  inputClass,
  type = 'text',
  placeholder,
  min,
  max,
}: FilterFieldProps): React.JSX.Element {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-xs font-medium text-muted-foreground"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        min={min}
        max={max}
        className={inputClass}
      />
    </div>
  )
}
