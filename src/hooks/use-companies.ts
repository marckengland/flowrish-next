'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

/**
 * TanStack Query hooks for company data.
 *
 * Validates: Requirement 19.3
 */

export interface CompaniesQueryInput {
  search?: string
  page?: number
  pageSize?: number
}

export interface CompanyListItem {
  id: string
  name: string
  industry: string | null
  website: string | null
  createdAt: string
  updatedAt: string
  _count: {
    contacts: number
    leads: number
  }
}

export interface CompaniesPage {
  data: CompanyListItem[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

function buildCompaniesQueryString(input: CompaniesQueryInput): string {
  const params = new URLSearchParams()
  if (input.page !== undefined) params.set('page', String(input.page))
  if (input.pageSize !== undefined) params.set('pageSize', String(input.pageSize))
  if (input.search) params.set('search', input.search)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

async function fetchCompanies(input: CompaniesQueryInput): Promise<CompaniesPage> {
  const qs = buildCompaniesQueryString(input)
  const res = await fetch(`/api/companies${qs}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  })
  if (!res.ok) {
    let message = `Failed to load companies (${res.status})`
    try {
      const body = (await res.json()) as { error?: { message?: string } }
      if (body.error?.message) message = body.error.message
    } catch {
      // ignore
    }
    throw new Error(message)
  }
  return (await res.json()) as CompaniesPage
}

export const companiesKeys = {
  all: ['companies'] as const,
  list: (input: CompaniesQueryInput) => [...companiesKeys.all, 'list', input] as const,
  detail: (id: string) => [...companiesKeys.all, 'detail', id] as const,
}

/**
 * Fetches a paginated page of companies.
 */
export function useCompaniesQuery(input: CompaniesQueryInput) {
  return useQuery({
    queryKey: companiesKeys.list(input),
    queryFn: () => fetchCompanies(input),
  })
}

/**
 * Deletes a company by ID and invalidates the companies list cache.
 */
export function useDeleteCompanyMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/companies/${id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      if (!res.ok && res.status !== 204) {
        let message = `Failed to delete company (${res.status})`
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
      queryClient.invalidateQueries({ queryKey: companiesKeys.all })
    },
  })
}
