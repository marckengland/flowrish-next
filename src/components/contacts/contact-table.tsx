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

  function handleDelete(id: string, name: string) {
    if (confirm(`Delete contact "${name}"? This cannot be undone.`)) {
      deleteMutation.mutate(id)
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

      {query.isError ? (
        <div
          role="alert"
          className="rounded-lg border bg-card p-8 text-center text-sm text-destructive"
        >
          Couldn&apos;t load contacts.{' '}
          {query.error instanceof Error ? query.error.message : ''}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
          {currentSearch ? 'No contacts match your search.' : 'No contacts yet.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b bg-muted/40 text-left">
              <tr>
                <th scope="col" className="eyebrow px-4 py-3">
                  Name
                </th>
                <th scope="col" className="eyebrow px-4 py-3">
                  Role
                </th>
                <th scope="col" className="eyebrow px-4 py-3">
                  Company
                </th>
                <th scope="col" className="eyebrow px-4 py-3">
                  Email
                </th>
                <th scope="col" className="eyebrow px-4 py-3">
                  Phone
                </th>
                <th scope="col" className="eyebrow px-4 py-3 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-row-divider">
              {rows.map((contact) => {
                const fullName = `${contact.firstName} ${contact.lastName}`.trim()
                return (
                  <tr
                    key={contact.id}
                    className="relative cursor-pointer transition-colors hover:bg-background focus-within:bg-background"
                  >
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
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

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


