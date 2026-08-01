'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2, Mail, Phone, Trash2 } from 'lucide-react'

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
 * Card-grid list for the contacts page.
 *
 * - Fetches data via TanStack Query (`useContactsQuery`)
 * - Supports search filtering
 * - Each card links to contact detail; a stretched overlay link keeps
 *   the whole card clickable while the delete control stays reachable.
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
        <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((contact) => {
            const fullName = `${contact.firstName} ${contact.lastName}`.trim()
            const roleCompany = [contact.jobTitle, contact.company?.name]
              .filter(Boolean)
              .join(' · ')
            return (
              <div
                key={contact.id}
                className="group relative rounded-lg border bg-card p-4 transition-colors hover:bg-background"
              >
                <Link
                  href={`/contacts/${contact.id}`}
                  aria-label={`Open ${fullName}`}
                  className="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />

                <div className="mb-3.5 flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-[42px] shrink-0 items-center justify-center rounded-full bg-brand-subtle text-sm font-semibold text-brand-emphasis"
                  >
                    {initials(contact.firstName, contact.lastName)}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      {fullName}
                    </div>
                    {roleCompany ? (
                      <div className="truncate text-xs text-muted-foreground">
                        {roleCompany}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5 text-[12.5px] text-muted-foreground">
                  {contact.email ? (
                    <div className="flex items-center gap-2">
                      <Mail className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="truncate">{contact.email}</span>
                    </div>
                  ) : null}
                  {contact.phone ? (
                    <div className="flex items-center gap-2">
                      <Phone className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="truncate">{contact.phone}</span>
                    </div>
                  ) : null}
                </div>

                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() =>
                    handleDelete(contact.id, fullName)
                  }
                  disabled={deleteMutation.isPending}
                  aria-label={`Delete ${fullName}`}
                  className="absolute right-2 top-2 z-10 text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
            )
          })}
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

/**
 * Two-letter initials from a contact's name, used for the avatar chip.
 */
function initials(firstName: string, lastName: string): string {
  const a = firstName.trim().charAt(0)
  const b = lastName.trim().charAt(0)
  return `${a}${b}`.toUpperCase() || '?'
}
