'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2, Search, Trash2 } from 'lucide-react'

import { useCompaniesQuery, useDeleteCompanyMutation, type CompanyListItem } from '@/hooks/use-companies'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export interface CompanyTableProps {
  /** Initial data rendered server-side for instant paint. */
  initialData?: {
    data: CompanyListItem[]
    pagination: {
      page: number
      pageSize: number
      total: number
      totalPages: number
    }
  }
  /** Search filter. */
  search?: string
  /** Default page. */
  page?: number
  /** Default page size. */
  pageSize?: number
}

/**
 * Data table for the companies list page.
 *
 * - Fetches data via TanStack Query (`useCompaniesQuery`)
 * - Supports search filtering
 * - Shows contact and lead counts per company
 *
 * Validates: Requirement 19.3
 */
export function CompanyTable({
  initialData,
  search,
  page = 1,
  pageSize = 20,
}: CompanyTableProps): React.JSX.Element {
  const [currentSearch, setCurrentSearch] = useState(search ?? '')

  const query = useCompaniesQuery({ search: currentSearch || undefined, page, pageSize })
  const companiesPage = query.data ?? initialData
  const rows = companiesPage?.data ?? []

  const deleteMutation = useDeleteCompanyMutation()

  function handleDelete(id: string, name: string) {
    if (confirm(`Delete company "${name}"? Contacts and leads will be unlinked.`)) {
      deleteMutation.mutate(id)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Search input */}
      <div className="flex items-center gap-3">
        <div className="relative w-full max-w-[320px]">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-[15px] -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={currentSearch}
            onChange={(e) => setCurrentSearch(e.target.value)}
            placeholder="Search companies…"
            aria-label="Search companies"
            className="pl-9"
          />
        </div>
        {query.isFetching && (
          <div role="status" aria-live="polite" className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
            <span>Loading…</span>
          </div>
        )}
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-[13.5px]">
            <thead>
              <tr className="border-b bg-background text-left">
                <th scope="col" className="eyebrow px-4 py-[11px]">Name</th>
                <th scope="col" className="eyebrow px-4 py-[11px]">Industry</th>
                <th scope="col" className="eyebrow px-4 py-[11px]">Website</th>
                <th scope="col" className="eyebrow px-4 py-[11px] text-right">Contacts</th>
                <th scope="col" className="eyebrow px-4 py-[11px] text-right">Leads</th>
                <th scope="col" className="px-4 py-[11px]">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-row-divider">
              {query.isError ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-destructive" role="alert">
                    Couldn&apos;t load companies.{' '}
                    {query.error instanceof Error ? query.error.message : ''}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    {currentSearch ? 'No companies match your search.' : 'No companies yet.'}
                  </td>
                </tr>
              ) : (
                rows.map((company) => (
                  <tr
                    key={company.id}
                    className="relative cursor-pointer transition-colors hover:bg-background focus-within:bg-background"
                  >
                    <td className="px-4 py-3 font-semibold text-foreground">
                      <Link
                        href={`/companies/${company.id}`}
                        aria-label={`Open ${company.name}`}
                        className="text-foreground before:absolute before:inset-0 before:content-[''] hover:underline focus-visible:underline focus-visible:outline-none"
                      >
                        {company.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {company.industry ?? '—'}
                    </td>
                    <td className="relative z-10 px-4 py-3">
                      {company.website ? (
                        <a
                          href={company.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-brand-emphasis hover:underline"
                        >
                          {safeHostname(company.website)}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="tnum px-4 py-3 text-right text-muted-foreground">
                      {company._count.contacts}
                    </td>
                    <td className="tnum px-4 py-3 text-right text-muted-foreground">
                      {company._count.leads}
                    </td>
                    <td className="relative z-10 px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleDelete(company.id, company.name)}
                        disabled={deleteMutation.isPending}
                        aria-label={`Delete ${company.name}`}
                      >
                        <Trash2 className="size-4 text-muted-foreground" aria-hidden="true" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {companiesPage?.pagination && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          Showing {rows.length} of {companiesPage.pagination.total} companies
          {companiesPage.pagination.totalPages > 1 && (
            <> · Page {companiesPage.pagination.page} of {companiesPage.pagination.totalPages}</>
          )}
        </p>
      )}
    </div>
  )
}

/**
 * Extracts a hostname from a URL for display. Falls back to the raw URL
 * when parsing fails so a malformed website string doesn't crash the
 * whole table.
 */
function safeHostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}
