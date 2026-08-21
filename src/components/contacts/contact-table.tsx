'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, Trash2, Users } from 'lucide-react'

import { useContactsQuery, useDeleteContactMutation, type ContactListItem } from '@/hooks/use-contacts'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Pagination } from '@/components/ui/pagination'
import { Table, TableHead, Th, SortableTh, TableBody, Tr, TableState } from '@/components/ui/table'
import { sortByKey, type SortDir } from '@/lib/table-sort'
import { toast } from '@/lib/toast'

type ContactSortKey = 'name' | 'role' | 'company' | 'email' | 'phone'

function contactSortValue(
  contact: ContactListItem,
  key: ContactSortKey,
): string | null | undefined {
  switch (key) {
    case 'name':
      return `${contact.firstName} ${contact.lastName}`.trim()
    case 'role':
      return contact.jobTitle
    case 'company':
      return contact.company?.name
    case 'email':
      return contact.email
    case 'phone':
      return contact.phone
  }
}

export interface ContactTableProps {
  /** Initial data rendered server-side for instant paint. */
  initialData?: {
    data: ContactListItem[]
    pagination: {
      page: number
      pageSize: number
      total: number
      totalPages: number
    }
  }
  /** Search filter. */
  search?: string
  /** Company filter. */
  companyId?: string
  /** Default page. */
  page?: number
  /** Default page size. */
  pageSize?: number
}

/**
 * Table list for the contacts page, matching the Leads table layout.
 *
 * - Fetches data via TanStack Query (`useContactsQuery`)
 * - Supports search filtering
 * - Each row links to contact detail via a stretched cell link; the delete
 *   control sits above the overlay so it stays clickable.
 *
 * Validates: Requirement 19.1
 */
export function ContactTable({
  initialData,
  search,
  companyId,
  page: initialPage = 1,
  pageSize: initialPageSize = 20,
}: ContactTableProps): React.JSX.Element {
  const [currentSearch, setCurrentSearch] = useState(search ?? '')
  const [page, setPage] = useState(initialPage)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const [sortKey, setSortKey] = useState<ContactSortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const query = useContactsQuery({ search: currentSearch || undefined, companyId, page, pageSize })
  const contactsPage = query.data ?? initialData
  const rows = useMemo(() => contactsPage?.data ?? [], [contactsPage])

  const sorted = useMemo(
    () => sortByKey(rows, (c) => contactSortValue(c, sortKey), sortDir),
    [rows, sortKey, sortDir],
  )

  function toggleSort(key: string): void {
    const next = key as ContactSortKey
    if (next === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(next)
    setSortDir('asc')
  }

  const deleteMutation = useDeleteContactMutation()
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
      toast.error("Couldn't delete contact", {
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Search input */}
      <div className="flex items-center gap-3">
        <Input
          type="search"
          value={currentSearch}
          onChange={(e) => {
            setCurrentSearch(e.target.value)
            setPage(1)
          }}
          placeholder="Search contacts…"
          aria-label="Search contacts"
          className="max-w-sm"
        />
        {query.isFetching && (
          <div role="status" aria-live="polite" className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
            <span>Loading…</span>
          </div>
        )}
      </div>

      <Table minWidth={720}>
        <TableHead>
          <SortableTh label="Name" sortKey="name" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
          <SortableTh label="Role" sortKey="role" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
          <SortableTh label="Company" sortKey="company" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
          <SortableTh label="Email" sortKey="email" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
          <SortableTh label="Phone" sortKey="phone" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
          <Th align="right">
            <span className="sr-only">Actions</span>
          </Th>
        </TableHead>
        <TableBody>
          {query.isError ? (
            <TableState colSpan={6} tone="error">
              Couldn&apos;t load contacts.{' '}
              {query.error instanceof Error ? query.error.message : ''}
            </TableState>
          ) : rows.length === 0 ? (
            <TableState
              colSpan={6}
              icon={<Users className="size-5" aria-hidden="true" />}
              title={
                currentSearch ? 'No contacts match your search' : 'No contacts yet'
              }
              description={
                currentSearch
                  ? 'Try a different name or clear the search.'
                  : 'Contacts you add or import will show up here.'
              }
            />
          ) : (
            sorted.map((contact) => {
              const fullName = `${contact.firstName} ${contact.lastName}`.trim()
              return (
                <Tr key={contact.id} className="cursor-pointer">
                    <td className="px-4 py-3 font-semibold">
                      <Link
                        href={`/contacts/${contact.id}`}
                        aria-label={`Open ${fullName}`}
                        className="text-foreground before:absolute before:inset-0 before:content-[''] hover:underline focus-visible:underline focus-visible:outline-none"
                      >
                        {fullName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {contact.jobTitle ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {contact.company?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {contact.email ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {contact.phone ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleDelete(contact.id, fullName)}
                        disabled={deleteMutation.isPending}
                        aria-label={`Delete ${fullName}`}
                        className="relative z-10 text-muted-foreground hover:text-danger-foreground"
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    </td>
                  </Tr>
                )
              })
            )}
          </TableBody>
        </Table>

      {contactsPage?.pagination && (
        <Pagination
          pagination={contactsPage.pagination}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size)
            setPage(1)
          }}
          itemLabel="contacts"
          loading={query.isFetching}
        />
      )}

      <ConfirmDialog
        open={confirmTarget !== null}
        onClose={() => setConfirmTarget(null)}
        onConfirm={confirmDelete}
        tone="danger"
        title="Delete contact"
        description={
          confirmTarget
            ? `Delete "${confirmTarget.name}"? This cannot be undone.`
            : undefined
        }
        confirmLabel="Delete"
      />
    </div>
  )
}


