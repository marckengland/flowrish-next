'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

/**
 * TanStack Query hooks for contact data.
 *
 * Validates: Requirement 19.1
 */

export interface ContactsQueryInput {
  search?: string
  companyId?: string
  page?: number
  pageSize?: number
}

export interface ContactListItem {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  jobTitle: string | null
  linkedinUrl: string | null
  country: string | null
  state: string | null
  companyId: string | null
  company: { id: string; name: string } | null
  createdAt: string
  updatedAt: string
}

export interface ContactsPage {
  data: ContactListItem[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

function buildContactsQueryString(input: ContactsQueryInput): string {
  const params = new URLSearchParams()
  if (input.page !== undefined) params.set('page', String(input.page))
  if (input.pageSize !== undefined) params.set('pageSize', String(input.pageSize))
  if (input.search) params.set('search', input.search)
  if (input.companyId) params.set('companyId', input.companyId)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

async function fetchContacts(input: ContactsQueryInput): Promise<ContactsPage> {
  const qs = buildContactsQueryString(input)
  const res = await fetch(`/api/contacts${qs}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  })
  if (!res.ok) {
    let message = `Failed to load contacts (${res.status})`
    try {
      const body = (await res.json()) as { error?: { message?: string } }
      if (body.error?.message) message = body.error.message
    } catch {
      // ignore
    }
    throw new Error(message)
  }
  return (await res.json()) as ContactsPage
}

export const contactsKeys = {
  all: ['contacts'] as const,
  list: (input: ContactsQueryInput) => [...contactsKeys.all, 'list', input] as const,
  detail: (id: string) => [...contactsKeys.all, 'detail', id] as const,
}

/**
 * Fetches a paginated page of contacts.
 */
export function useContactsQuery(input: ContactsQueryInput) {
  return useQuery({
    queryKey: contactsKeys.list(input),
    queryFn: () => fetchContacts(input),
  })
}

/**
 * Deletes a contact by ID and invalidates the contacts list cache.
 */
export function useDeleteContactMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/contacts/${id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      if (!res.ok && res.status !== 204) {
        let message = `Failed to delete contact (${res.status})`
        try {
          const body = (await res.json()) as { error?: { message?: string } }
          if (body.error?.message) message = body.error.message
        } catch {
          // ignore
        }
        throw new Error(message)
      }
      return id
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contactsKeys.all })
    },
  })
}
