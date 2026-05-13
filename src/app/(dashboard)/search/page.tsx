'use client'

import { useSearchParams } from 'next/navigation'
import { useCallback, useId, useState } from 'react'
import { Filter, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { SearchBar } from '@/components/search/search-bar'
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
 * SearchBar on navigation). Provides inline filter controls for entity type,
 * date range, and assigned user. Results are fetched client-side via TanStack
 * Query through the `SearchResults` component.
 *
 * This is a client component because it manages interactive filter state and
 * reads URL search params reactively.
 *
 * Validates: Requirements 12.2, 12.4
 */
export default function SearchPage(): React.JSX.Element {
  const searchParams = useSearchParams()
  const initialQuery = searchParams.get('q') ?? ''

  const [query, setQuery] = useState(initialQuery)
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState<SearchResultFilters>({})

  const entityTypeId = useId()
  const dateFromId = useId()
  const dateToId = useId()

  const handleSearch = useCallback((q: string) => {
    setQuery(q)
  }, [])

  const handleFilterChange = useCallback(
    <K extends keyof SearchResultFilters>(
      key: K,
      value: SearchResultFilters[K] | '',
    ) => {
      setFilters((prev) => {
        const next = { ...prev }
        if (!value) {
          delete next[key]
        } else {
          next[key] = value
        }
        return next
      })
    },
    [],
  )

  const clearFilters = useCallback(() => {
    setFilters({})
  }, [])

  const hasActiveFilters = Object.keys(filters).length > 0

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
            {hasActiveFilters && (
              <span className="ml-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                {Object.keys(filters).length}
              </span>
            )}
          </Button>
        </div>
      </header>

      {showFilters && (
        <section
          id="search-filters"
          aria-label="Search filters"
          className="flex flex-col gap-3 rounded-md border bg-card p-3 sm:flex-row sm:flex-wrap sm:items-end"
        >
          <FilterField id={entityTypeId} label="Entity type">
            <select
              id={entityTypeId}
              value={filters.entityType ?? ''}
              onChange={(e) =>
                handleFilterChange(
                  'entityType',
                  (e.target.value as SearchEntityType) || '',
                )
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
              value={filters.dateFrom ? filters.dateFrom.split('T')[0] : ''}
              onChange={(e) => {
                const val = e.target.value
                handleFilterChange(
                  'dateFrom',
                  val ? `${val}T00:00:00.000Z` : '',
                )
              }}
              className={selectClasses}
            />
          </FilterField>

          <FilterField id={dateToId} label="To date">
            <input
              id={dateToId}
              type="date"
              value={filters.dateTo ? filters.dateTo.split('T')[0] : ''}
              onChange={(e) => {
                const val = e.target.value
                handleFilterChange(
                  'dateTo',
                  val ? `${val}T23:59:59.999Z` : '',
                )
              }}
              className={selectClasses}
            />
          </FilterField>

          <div className="sm:ml-auto">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!hasActiveFilters}
              onClick={clearFilters}
              aria-label="Clear all filters"
            >
              <X className="size-4" aria-hidden="true" />
              <span>Clear</span>
            </Button>
          </div>
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
