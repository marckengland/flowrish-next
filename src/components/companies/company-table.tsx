'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Building2, Loader2, Search, Trash2 } from 'lucide-react'

import { useCompaniesQuery, useDeleteCompanyMutation, type CompanyListItem } from '@/hooks/use-companies'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Pagination } from '@/components/ui/pagination'
import {
  Table,
  TableHead,
  Th,
  TableBody,
  Tr,
  Td,
  TableState,
} from '@/components/ui/table'
import { toast } from '@/lib/toast'

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
  page: initialPage = 1,
  pageSize = 20,
}: CompanyTableProps): React.JSX.Element {
  const [currentSearch, setCurrentSearch] = useState(search ?? '')
  const [page, setPage] = useState(initialPage)

  const query = useCompaniesQuery({ search: currentSearch || undefined, page, pageSize })
  const companiesPage = query.data ?? initialData
  const rows = companiesPage?.data ?? []

  const deleteMutation = useDeleteCompanyMutation()
  const [confirmTarget, setConfirmTarget] = useState<{
    id: string
    name: string
  } | null>(null)

  function handleDelete(id: string, name: string) {
    setConfirmTarget({ id, name })
  }

  async function confirmDelete(): Promise<void> {
    if (!confirmTarget) return
    const { id, name } = confirmTarget
    try {
      await deleteMutation.mutateAsync(id)
      toast.success(`Deleted ${name}`)
      setConfirmTarget(null)
    } catch (err) {
      toast.error("Couldn't delete company", {
        description: err instanceof Error ? err.message : undefined,
      })
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
            onChange={(e) => {
              setCurrentSearch(e.target.value)
              setPage(1)
            }}
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

      <Table minWidth={600}>
        <TableHead>
          <Th>Name</Th>
          <Th>Industry</Th>
          <Th>Website</Th>
          <Th align="right">Contacts</Th>
          <Th align="right">Leads</Th>
          <Th>
            <span className="sr-only">Actions</span>
          </Th>
        </TableHead>
        <TableBody>
          {query.isError ? (
            <TableState colSpan={6} tone="error">
              Couldn&apos;t load companies.{' '}
              {query.error instanceof Error ? query.error.message : ''}
            </TableState>
          ) : rows.length === 0 ? (
            <TableState
              colSpan={6}
              icon={<Building2 className="size-5" aria-hidden="true" />}
              title={
                currentSearch ? 'No companies match your search' : 'No companies yet'
              }
              description={
                currentSearch
                  ? 'Try a different name or clear the search.'
                  : 'Companies are created automatically as you add leads and contacts.'
              }
            />
          ) : (
            rows.map((company) => (
              <Tr key={company.id} className="cursor-pointer">
                <Td className="font-semibold text-foreground">
                  <Link
                    href={`/companies/${company.id}`}
                    aria-label={`Open ${company.name}`}
                    className="text-foreground before:absolute before:inset-0 before:content-[''] hover:underline focus-visible:underline focus-visible:outline-none"
                  >
                    {company.name}
                  </Link>
                </Td>
                <Td className="text-muted-foreground">
                  {company.industry ?? '—'}
                </Td>
                <Td className="relative z-10">
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
                </Td>
                <Td align="right" className="tnum text-muted-foreground">
                  {company._count.contacts}
                </Td>
                <Td align="right" className="tnum text-muted-foreground">
                  {company._count.leads}
                </Td>
                <Td align="right" className="relative z-10">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleDelete(company.id, company.name)}
                    disabled={deleteMutation.isPending}
                    aria-label={`Delete ${company.name}`}
                  >
                    <Trash2 className="size-4 text-muted-foreground" aria-hidden="true" />
                  </Button>
                </Td>
              </Tr>
            ))
          )}
        </TableBody>
      </Table>

      {companiesPage?.pagination && (
        <Pagination
          pagination={companiesPage.pagination}
          onPageChange={setPage}
          itemLabel="companies"
          loading={query.isFetching}
        />
      )}

      <ConfirmDialog
        open={confirmTarget !== null}
        onClose={() => setConfirmTarget(null)}
        onConfirm={confirmDelete}
        tone="danger"
        title="Delete company"
        description={
          confirmTarget
            ? `Delete "${confirmTarget.name}"? Contacts and leads will be unlinked.`
            : undefined
        }
        confirmLabel="Delete"
      />
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
