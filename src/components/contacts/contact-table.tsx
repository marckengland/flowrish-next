'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2, Trash2, Users } from 'lucide-react'

import { useContactsQuery, useDeleteContactMutation, type ContactListItem } from '@/hooks/use-contacts'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Table, TableHead, Th, TableBody, Tr, TableState } from '@/components/ui/table'
import { toast } from '@/lib/toast'

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
  page = 1,
  pageSize = 20,
}: ContactTableProps): React.JSX.Element {
  const [currentSearch, setCurrentSearch] = useState(search ?? '')

  const query = useContactsQuery({ search: currentSearch || undefined, companyId, page, pageSize })
  const contactsPage = query.data ?? initialData
  const rows = contactsPage?.data ?? []

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
          onChange={(e) => setCurrentSearch(e.target.value)}
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
          <Th>Name</Th>
          <Th>Role</Th>
          <Th>Company</Th>
          <Th>Email</Th>
          <Th>Phone</Th>
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
            rows.map((contact) => {
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
                        className="relative z-10 text-muted-foreground hover:text-destructive"
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
        <p className="text-xs text-muted-foreground" aria-live="polite">
          Showing {rows.length} of {contactsPage.pagination.total} contacts
          {contactsPage.pagination.totalPages > 1 && (
            <> · Page {contactsPage.pagination.page} of {contactsPage.pagination.totalPages}</>
          )}
        </p>
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


