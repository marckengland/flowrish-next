'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2, Trash2 } from 'lucide-react'

import { useContactsQuery, useDeleteContactMutation, type ContactListItem } from '@/hooks/use-contacts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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
 * Data table for the contacts list page.
 *
 * - Fetches data via TanStack Query (`useContactsQuery`)
 * - Supports search filtering
 * - Links each row to contact detail (future)
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

  function handleDelete(id: string, name: string) {
    if (confirm(`Delete contact "${name}"? This cannot be undone.`)) {
      deleteMutation.mutate(id)
    }
  }

  return (
    <div className="flex flex-col gap-3">
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

      <div className="overflow-x-auto rounded-md border bg-card">
        <table className="w-full min-w-[700px] text-sm">
          <thead className="bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Name</th>
              <th scope="col" className="px-3 py-2 font-medium">Email</th>
              <th scope="col" className="px-3 py-2 font-medium">Phone</th>
              <th scope="col" className="px-3 py-2 font-medium">Job Title</th>
              <th scope="col" className="px-3 py-2 font-medium">Company</th>
              <th scope="col" className="px-3 py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {query.isError ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-destructive" role="alert">
                  Couldn&apos;t load contacts.{' '}
                  {query.error instanceof Error ? query.error.message : ''}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  {currentSearch ? 'No contacts match your search.' : 'No contacts yet.'}
                </td>
              </tr>
            ) : (
              rows.map((contact) => (
                <tr
                  key={contact.id}
                  className="relative cursor-pointer border-t transition-colors hover:bg-muted/30 focus-within:bg-muted/30"
                >
                  <td className="px-3 py-2 font-medium">
                    <Link
                      href={`/contacts/${contact.id}`}
                      className="text-foreground before:absolute before:inset-0 before:content-[''] hover:underline focus-visible:underline focus-visible:outline-none"
                    >
                      {contact.firstName} {contact.lastName}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {contact.email ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {contact.phone ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {contact.jobTitle ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {contact.company?.name ?? '—'}
                  </td>
                  <td className="relative z-10 px-3 py-2 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        handleDelete(
                          contact.id,
                          `${contact.firstName} ${contact.lastName}`,
                        )
                      }
                      disabled={deleteMutation.isPending}
                      aria-label={`Delete ${contact.firstName} ${contact.lastName}`}
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

      {contactsPage?.pagination && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          Showing {rows.length} of {contactsPage.pagination.total} contacts
          {contactsPage.pagination.totalPages > 1 && (
            <> · Page {contactsPage.pagination.page} of {contactsPage.pagination.totalPages}</>
          )}
        </p>
      )}
    </div>
  )
}
