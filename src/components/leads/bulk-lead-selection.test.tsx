import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useFiltersStore } from '@/stores/filters'
import { coreLead } from '../../../e2e/rehearsal-app/core-fixtures'
const m = vi.hoisted(() => ({ fetching: false }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/hooks/use-leads', () => ({ useLeadsQuery: () => ({ data: { data: [coreLead()], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }, isFetching: m.fetching }) }))
vi.mock('./bulk-lead-controls', () => ({ BulkLeadControls: ({ selection }: { selection: unknown[] }) => <p>{selection.length} selected in control</p> }))
import { LeadTable } from './lead-table'
beforeEach(() => { useFiltersStore.getState().setLeadFilters({}); localStorage.clear(); m.fetching = false })
it('permanently clears current-page selection when filters change even if the original filter is restored', () => {
  render(<QueryClientProvider client={new QueryClient()}><LeadTable bulk={{ organizationId: 'org', userId: 'user' }} /></QueryClientProvider>)
  fireEvent.click(screen.getByLabelText('Select all leads on this page')); expect(screen.getByText('1 selected in control')).toBeInTheDocument()
  act(() => useFiltersStore.getState().setLeadFilters({ leadStatus: 'NEW' })); expect(screen.getByText('0 selected in control')).toBeInTheDocument()
  act(() => useFiltersStore.getState().setLeadFilters({})); expect(screen.getByLabelText('Select all leads on this page')).not.toBeChecked(); expect(screen.getByText('0 selected in control')).toBeInTheDocument()
})
it('keeps selection controls absent without write-authorized bulk context', () => {
  render(<LeadTable />); expect(screen.queryByLabelText('Select all leads on this page')).not.toBeInTheDocument()
})
it('clears selection when a saved view reapplies the same filters', () => {
  render(<QueryClientProvider client={new QueryClient()}><LeadTable bulk={{ organizationId: 'org', userId: 'user' }} /></QueryClientProvider>)
  fireEvent.click(screen.getByLabelText('Select all leads on this page')); expect(screen.getByText('1 selected in control')).toBeInTheDocument()
  act(() => useFiltersStore.getState().setLeadFilters({})); expect(screen.getByLabelText('Select all leads on this page')).not.toBeChecked(); expect(screen.getByText('0 selected in control')).toBeInTheDocument()
})
