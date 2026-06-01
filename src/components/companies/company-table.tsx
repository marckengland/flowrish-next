'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, Trash2 } from 'lucide-react'

import { useCompaniesQuery, useDeleteCompanyMutation, type CompanyListItem } from '@/hooks/use-companies'
import { Button } from '@/components/ui/button'

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
  const router = useRouter()

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
    <div className="flex flex-col gap-3">
      {/* Search input */}
      <div className="flex items-center gap-3">
        <input
          type="search"
          value={currentSearch}
          onChange={(e) => setCurrentSearch(e.target.value)}
          placeholder="Search companies…"
          aria-label="Search companies"
          className="h-9 w-full max-w-sm rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {query.isFetching && (
          <div role="status" aria-live="polite" className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
            <span>Loading…</span>
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-md border bg-card">
        <table className="w-full min-w-[600px] text-sm">
          <thead className="bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Name</th>
              <th scope="col" className="px-3 py-2 font-medium">Industry</th>
              <th scope="col" className="px-3 py-2 font-medium">Website</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Contacts</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Leads</th>
              <th scope="col" className="px-3 py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {query.isError ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-destructive" role="alert">
                  Couldn&apos;t load companies.{' '}
                  {query.error instanceof Error ? query.error.message : ''}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  {currentSearch ? 'No companies match your search.' : 'No companies yet.'}
                </td>
              </tr>
            ) : (
              rows.map((company) => (
                <tr
                  key={company.id}
                  onClick={() => router.push(`/companies/${company.id}`)}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && e.currentTarget === e.target) {
                      e.preventDefault()
                      router.push(`/companies/${company.id}`)
                    }
                  }}
                  tabIndex={0}
                  role="link"
                  aria-label={`Open ${company.name}`}
                  className="cursor-pointer border-t transition-colors hover:bg-muted/30 focus-visible:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <td className="px-3 py-2 font-medium text-foreground">
                    <Link
                      href={`/companies/${company.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="hover:underline"
                    >
                      {company.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {company.industry ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {company.website ? (
                      <a
                        href={company.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-primary hover:underline"
                      >
                        {new URL(company.website).hostname}
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {company._count.contacts}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {company._count.leads}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(company.id, company.name)
                      }}
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
