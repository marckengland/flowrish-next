import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const query = vi.hoisted(() => ({
  data: undefined,
  isLoading: true,
  isFetching: true,
  isError: false,
  error: null,
}))
vi.mock('@/hooks/use-leads', () => ({ useLeadsQuery: () => query }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
import { LeadTable } from './lead-table'
import { useFiltersStore } from '@/stores/filters'
afterEach(() => {
  cleanup()
  useFiltersStore.setState({ leads: {} })
})
it('does not show unfiltered server rows while a different filter is loading', () => {
  useFiltersStore.setState({ leads: { search: 'different' } })
  render(
    <LeadTable
      initialData={{
        data: [
          {
            id: 'synthetic',
            firstName: 'Unfiltered',
            lastName: 'Prospect',
          } as never,
        ],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      }}
    />,
  )
  expect(screen.queryByText('Unfiltered Prospect')).not.toBeInTheDocument()
  expect(screen.getByText('Loading leads…')).toBeInTheDocument()
})
