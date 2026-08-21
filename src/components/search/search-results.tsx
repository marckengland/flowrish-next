'use client'

import Link from 'next/link'
import { Building2, Contact, UserRound } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { cn } from '@/lib/utils'
import type { SearchEntityType } from '@/server/services/search'

/**
 * Shape of a single search result returned by `GET /api/search`.
 */
export interface SearchResultItem {
  entityType: SearchEntityType
  id: string
  name: string
  matchScore: number
}

/**
 * Filters that can be applied to narrow search results.
 */
export interface SearchResultFilters {
  entityType?: SearchEntityType
  dateFrom?: string
  dateTo?: string
  assignedUserId?: string
  /**
   * Lead-only — substring matched against the stage's name. Ignored
   * for Contact / Company results.
   */
  stageName?: string
  /** Lead-only — minimum lead score, 0–100 inclusive. */
  scoreMin?: number
  /** Lead-only — maximum lead score, 0–100 inclusive. */
  scoreMax?: number
}

export interface SearchResultsProps {
  /** The search query string. */
  query: string
  /** Optional filters to narrow results. */
  filters?: SearchResultFilters
  /** Additional class names for the root wrapper. */
  className?: string
}

/**
 * Builds the query string for the search API call.
 */
function buildSearchQueryString(
  query: string,
  filters?: SearchResultFilters,
): string {
  const params = new URLSearchParams({ q: query })
  if (filters?.entityType) params.set('entityType', filters.entityType)
  if (filters?.dateFrom) params.set('dateFrom', filters.dateFrom)
  if (filters?.dateTo) params.set('dateTo', filters.dateTo)
  if (filters?.assignedUserId) params.set('assignedUserId', filters.assignedUserId)
  if (filters?.stageName) params.set('stageName', filters.stageName)
  if (filters?.scoreMin !== undefined)
    params.set('scoreMin', String(filters.scoreMin))
  if (filters?.scoreMax !== undefined)
    params.set('scoreMax', String(filters.scoreMax))
  return params.toString()
}

/**
 * Fetches search results from the API.
 */
async function fetchSearchResults(
  query: string,
  filters?: SearchResultFilters,
): Promise<SearchResultItem[]> {
  const qs = buildSearchQueryString(query, filters)
  const res = await fetch(`/api/search?${qs}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  })
  if (!res.ok) {
    let message = `Search failed (${res.status})`
    try {
      const body = (await res.json()) as { error?: { message?: string } }
      if (body.error?.message) message = body.error.message
    } catch {
      // ignore
    }
    throw new Error(message)
  }
  const json = (await res.json()) as { data: SearchResultItem[] }
  return json.data
}

/** TanStack Query key factory for search queries. */
export const searchKeys = {
  all: ['search'] as const,
  results: (query: string, filters?: SearchResultFilters) =>
    [...searchKeys.all, 'results', query, filters] as const,
}

/**
 * Hook to fetch search results via TanStack Query.
 */
export function useSearchResults(query: string, filters?: SearchResultFilters) {
  return useQuery({
    queryKey: searchKeys.results(query, filters),
    queryFn: () => fetchSearchResults(query, filters),
    enabled: query.trim().length > 0,
  })
}

/**
 * Displays ranked search results across Lead, Contact, and Company entity types.
 *
 * Results are fetched via TanStack Query from `GET /api/search` and rendered
 * as a list grouped by relevance score. Each result links to the appropriate
 * detail page for its entity type.
 *
 * Accessibility:
 * - Uses a `<section>` with `aria-label` for landmark semantics
 * - Each result is a link with descriptive text
 * - Loading and empty states are announced via `aria-live`
 *
 * Validates: Requirements 12.2, 12.4
 */
export function SearchResults({
  query,
  filters,
  className,
}: SearchResultsProps): React.JSX.Element {
  const { data: results, isLoading, error } = useSearchResults(query, filters)

  if (isLoading) {
    return (
      <div
        aria-live="polite"
        aria-busy="true"
        className={cn('flex flex-col gap-2', className)}
      >
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-md border bg-muted/40"
          />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div
        role="alert"
        className={cn(
          'rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive',
          className,
        )}
      >
        {error instanceof Error ? error.message : 'An error occurred while searching.'}
      </div>
    )
  }

  if (!results || results.length === 0) {
    return (
      <div
        aria-live="polite"
        className={cn(
          'flex flex-col items-center gap-2 rounded-md border bg-card p-8 text-center',
          className,
        )}
      >
        <p className="text-sm font-medium text-foreground">No results found</p>
        <p className="text-sm text-muted-foreground">
          Try adjusting your search query or filters.
        </p>
      </div>
    )
  }

  return (
    <section
      aria-label={`Search results for "${query}"`}
      className={cn('flex flex-col gap-1', className)}
    >
      <p className="eyebrow tnum mb-3 text-muted-foreground">
        {results.length} {results.length === 1 ? 'result' : 'results'}
      </p>
      <ul className="flex flex-col gap-[9px]" role="list">
        {results.map((result) => (
          <li key={`${result.entityType}-${result.id}`}>
            <SearchResultCard result={result} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Individual search result card linking to the entity detail page.
 */
function SearchResultCard({
  result,
}: {
  result: SearchResultItem
}): React.JSX.Element {
  const href = getEntityHref(result.entityType, result.id)
  const Icon = getEntityIcon(result.entityType)
  const typeLabel = getEntityLabel(result.entityType)

  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3.5 rounded-[11px] border bg-card px-4 py-[13px] transition-colors',
        'hover:bg-muted/50 focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand/15 focus-visible:outline-none',
      )}
    >
      <span
        className={cn(
          'flex size-[34px] shrink-0 items-center justify-center rounded-[9px]',
          getEntityBgColor(result.entityType),
        )}
        aria-hidden="true"
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-semibold text-foreground">
          {result.name}
        </p>
        <p className="text-[11.5px] text-muted-foreground">{typeLabel}</p>
      </div>
      <span
        className="shrink-0 text-[11px] tnum text-muted-foreground"
        style={{ fontFamily: 'var(--font-mono)' }}
        title={`Relevance score: ${result.matchScore.toFixed(2)}`}
      >
        {formatScore(result.matchScore)}
      </span>
    </Link>
  )
}

/**
 * Returns the detail page URL for a given entity type and ID.
 */
function getEntityHref(entityType: SearchEntityType, id: string): string {
  switch (entityType) {
    case 'Lead':
      return `/leads/${id}`
    case 'Contact':
      return `/contacts/${id}`
    case 'Company':
      return `/companies/${id}`
  }
}

/**
 * Returns the icon component for a given entity type.
 */
function getEntityIcon(entityType: SearchEntityType) {
  switch (entityType) {
    case 'Lead':
      return UserRound
    case 'Contact':
      return Contact
    case 'Company':
      return Building2
  }
}

/**
 * Returns a human-readable label for a given entity type.
 */
function getEntityLabel(entityType: SearchEntityType): string {
  switch (entityType) {
    case 'Lead':
      return 'Lead'
    case 'Contact':
      return 'Contact'
    case 'Company':
      return 'Company'
  }
}

/**
 * Returns the background color class for the entity type icon.
 */
function getEntityBgColor(entityType: SearchEntityType): string {
  switch (entityType) {
    case 'Lead':
      return 'bg-info-subtle text-info'
    case 'Contact':
      return 'bg-brand-subtle text-brand-emphasis'
    case 'Company':
      return 'bg-ai-subtle text-ai'
  }
}

/**
 * Formats a relevance score for display.
 */
function formatScore(score: number): string {
  if (score >= 1) return `${score.toFixed(1)}`
  if (score > 0) return `${(score * 10).toFixed(1)}`
  return '—'
}
