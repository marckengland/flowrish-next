'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { LeadFilters } from '@/stores/filters'

/**
 * TanStack Query hooks for lead data.
 *
 * Follows the project's separation of concerns: server state lives in
 * TanStack Query (with typed fetch helpers below), while client filter
 * state lives in the Zustand `filters` store. Components combine both
 * by reading filters from Zustand and passing them as inputs to
 * `useLeadsQuery`, which keys the query cache on the filter shape.
 *
 * Validates: Requirements 4.4, 4.6, 26.3
 */

export interface LeadsQueryInput {
  filters: LeadFilters
  page?: number
  pageSize?: number
}

/**
 * Lead list item shape returned by `GET /api/leads`. Kept deliberately
 * loose for Decimal/Date serialization — the API JSON-encodes Decimal as
 * string and Date as ISO string.
 */
export interface LeadListItem {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  title: string | null
  dealValue: string | number | null
  currency: string
  score: number
  leadStatus: string
  tier: string | null
  companyName: string | null
  stageId: string
  assignedUserId: string | null
  lastActivityAt: string | null
  createdAt: string
  updatedAt: string
  stage?: {
    id: string
    name: string
    order: number
    isClosedWon: boolean
    isClosedLost: boolean
  }
  assignedUser?: {
    id: string
    name: string
    email: string
  } | null
}

export interface LeadsPage {
  data: LeadListItem[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

/**
 * Builds the querystring for `GET /api/leads`. Undefined filter values are
 * omitted so the resulting URL (and TanStack Query key) stays stable.
 */
export function buildLeadsQueryString(input: LeadsQueryInput): string {
  const params = new URLSearchParams()
  const { filters, page, pageSize } = input
  if (page !== undefined) params.set('page', String(page))
  if (pageSize !== undefined) params.set('pageSize', String(pageSize))
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && v !== '') {
      params.set(k, String(v))
    }
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

async function fetchLeads(input: LeadsQueryInput): Promise<LeadsPage> {
  const qs = buildLeadsQueryString(input)
  const res = await fetch(`/api/leads${qs}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  })
  if (!res.ok) {
    let message = `Failed to load leads (${res.status})`
    try {
      const body = (await res.json()) as { error?: { message?: string } }
      if (body.error?.message) message = body.error.message
    } catch {
      // ignore JSON parse failures — keep the default message
    }
    throw new Error(message)
  }
  return (await res.json()) as LeadsPage
}

export const leadsKeys = {
  all: ['leads'] as const,
  list: (input: LeadsQueryInput) =>
    [...leadsKeys.all, 'list', input] as const,
  detail: (id: string) => [...leadsKeys.all, 'detail', id] as const,
}

/**
 * Fetches a paginated page of leads, keyed on the filters + pagination shape.
 * Pass filters from the Zustand filters store to keep client UI state
 * and server-state queries in sync without duplicating storage.
 */
export function useLeadsQuery(input: LeadsQueryInput, initialData?: LeadsPage) {
  return useQuery({
    queryKey: leadsKeys.list(input),
    queryFn: () => fetchLeads(input),
    initialData,
    // Always refetch when the list mounts so returning to /leads after
    // creating a lead shows the new row instead of a stale cached page.
    refetchOnMount: 'always',
  })
}

/**
 * Deletes (soft-deletes) a lead by ID and invalidates the leads list cache
 * so the listing refetches without the deleted row.
 */
export function useDeleteLeadMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/leads/${id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      if (!res.ok && res.status !== 204) {
        let message = `Failed to delete lead (${res.status})`
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
      queryClient.invalidateQueries({ queryKey: leadsKeys.all })
    },
  })
}
