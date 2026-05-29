'use client'

import { useSearchParams } from 'next/navigation'
import { useCallback, useId, useMemo, useState } from 'react'
import { Filter, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { SearchBar } from '@/components/search/search-bar'
import {
  FilterPanel,
  emptySearchFilters,
  type SearchFilters as PanelFilters,
} from '@/components/search/filter-panel'
import {
  SearchResults,
  type SearchResultFilters,
} from '@/components/search/search-results'
import type { SearchEntityType } from '@/server/services/search'

const ENTITY_TYPE_OPTIONS: { value: SearchEntityType; label: string }[] = [
  { value: 'Lead', label: 'Leads' },
  { value: 'Contact', label: 'Contacts' },
  { value: 'Company', label: 'Companies' },
]

/**
 * Search results page.
 *
 * Reads the initial query from the `q` URL search param (set by the global
 * SearchBar on navigation). Provides:
 *   - an entity-type / date-range filter row (applies to all entity types)
 *   - the shared `FilterPanel` for lead-specific filters (stage / score
 *     range / assigned user) — those filters are silently ignored when
 *     filtering Contacts or Companies.
 *
 * Results are fetched client-side via TanStack Query through the
 * `SearchResults` component.
 *
 * Validates: Requirements 12.2, 12.4
 */
export default function SearchPage(): React.JSX.Element {
  const searchParams = useSearchParams()
  const initialQuery = searchParams.get('q') ?? ''

  const [query, setQuery] = useState(initialQuery)
  const [showFilters, setShowFilters] = useState(false)
  const [entityType, setEntityType] = useState<SearchEntityType | ''>('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [leadFilters, setLeadFilters] = useState<PanelFilters>(emptySearchFilters)

  const entityTypeId = useId()
  const dateFromId = useId()
  const dateToId = useId()

  const handleSearch = useCallback((q: string) => {
    setQuery(q)
  }, [])

  const filters = useMemo<SearchResultFilters>(() => {
    const out: SearchResultFilters = {}
    if (entityType) out.entityType = entityType
    if (dateFrom) out.dateFrom = `${dateFrom}T00:00:00.000Z`
    if (dateTo) out.dateTo = `${dateTo}T23:59:59.999Z`
    // Lead-only filters from FilterPanel — only apply when the user
    // hasn't restricted to Contact/Company. The server ignores them
    // for non-Lead types anyway, but skipping them client-side keeps
    // the URL clean and avoids unnecessary cache misses.
    if (entityType === 'Lead' || entityType === '') {
      if (leadFilters.stage) out.stageName = leadFilters.stage
      if (leadFilters.assignedTo) {
        out.assignedUserId = leadFilters.assignedTo
      }
      if (leadFilters.scoreMin) {
        const n = Number(leadFilters.scoreMin)
        if (Number.isFinite(n)) out.scoreMin = n
      }
      if (leadFilters.scoreMax) {
        const n = Number(leadFilters.scoreMax)
        if (Number.isFinite(n)) out.scoreMax = n
      }
      // The shared FilterPanel also has start/end dates. Surface them
      // through the same dateFrom/dateTo channel so the user only has
      // to pick once. The dedicated row above takes priority when both
      // are set.
      if (!out.dateFrom && leadFilters.startDate) {
        out.dateFrom = `${leadFilters.startDate}T00:00:00.000Z`
      }
      if (!out.dateTo && leadFilters.endDate) {
        out.dateTo = `${leadFilters.endDate}T23:59:59.999Z`
      }
    }
    return out
  }, [entityType, dateFrom, dateTo, leadFilters])

  const clearAllFilters = useCallback(() => {
    setEntityType('')
    setDateFrom('')
    setDateTo('')
    setLeadFilters(emptySearchFilters)
  }, [])

  const activeFilterCount = useMemo(() => {
    let n = 0
    if (entityType) n++
    if (dateFrom) n++
    if (dateTo) n++
    if (leadFilters.stage) n++
    if (leadFilters.scoreMin) n++
    if (leadFilters.scoreMax) n++
    if (leadFilters.startDate) n++
    if (leadFilters.endDate) n++
    if (leadFilters.assignedTo) n++
    return n
  }, [entityType, dateFrom, dateTo, leadFilters])

  const showLeadFilters = entityType === 'Lead' || entityType === ''

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
          <p className="text-sm text-muted-foreground">
            Find leads, contacts, and companies across your organization.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <SearchBar
            defaultValue={initialQuery}
            navigateOnSubmit={false}
            onSearch={handleSearch}
            className="max-w-lg"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
            aria-controls="search-filters"
          >
            <Filter className="size-4" aria-hidden="true" />
            <span>Filters</span>
            {activeFilterCount > 0 && (
              <span className="ml-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </Button>
        </div>
      </header>

      {showFilters && (
        <section
          id="search-filters"
          aria-label="Search filters"
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-3 rounded-md border bg-card p-3 sm:flex-row sm:flex-wrap sm:items-end">
            <FilterField id={entityTypeId} label="Entity type">
              <select
                id={entityTypeId}
                value={entityType}
                onChange={(e) =>
                  setEntityType((e.target.value as SearchEntityType) || '')
                }
                className={selectClasses}
              >
                <option value="">All types</option>
                {ENTITY_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField id={dateFromId} label="From date">
              <input
                id={dateFromId}
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className={selectClasses}
              />
            </FilterField>

            <FilterField id={dateToId} label="To date">
              <input
                id={dateToId}
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className={selectClasses}
              />
            </FilterField>

            <div className="sm:ml-auto">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={activeFilterCount === 0}
                onClick={clearAllFilters}
                aria-label="Clear all filters"
              >
                <X className="size-4" aria-hidden="true" />
                <span>Clear</span>
              </Button>
            </div>
          </div>

          {showLeadFilters && (
            <FilterPanel
              filters={leadFilters}
              onChange={setLeadFilters}
              onClear={() => setLeadFilters(emptySearchFilters)}
            />
          )}
        </section>
      )}

      {query ? (
        <SearchResults query={query} filters={filters} />
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-md border bg-card p-8 text-center">
          <p className="text-sm font-medium text-foreground">
            Enter a search query
          </p>
          <p className="text-sm text-muted-foreground">
            Search across leads, contacts, and companies in your organization.
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * Filter field wrapper with label.
 */
function FilterField({
  id,
  label,
  children,
}: {
  id: string
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-[14rem]">
      <label
        htmlFor={id}
        className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        {label}
      </label>
      {children}
    </div>
  )
}

const selectClasses =
  'h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50'
