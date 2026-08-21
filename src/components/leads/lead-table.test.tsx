import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { LeadTable, sortLeads } from './lead-table'
import type { LeadListItem } from '@/hooks/use-leads'
import { useFiltersStore } from '@/stores/filters'

vi.mock('next/navigation', () => ({
  usePathname: () => '/leads',
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}))

function makeLead(overrides: Partial<LeadListItem>): LeadListItem {
  return {
    id: 'lead-' + Math.random().toString(36).slice(2, 8),
    firstName: 'First',
    lastName: 'Last',
    email: null,
    phone: null,
    title: null,
    dealValue: null,
    currency: 'USD',
    score: 0,
    leadStatus: 'NEW',
    tier: null,
    companyName: null,
    stageId: 'stage-1',
    assignedUserId: null,
    lastActivityAt: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    stage: { id: 'stage-1', name: 'New', order: 1, isClosedWon: false, isClosedLost: false },
    assignedUser: null,
    ...overrides,
  }
}

function mount(ui: React.JSX.Element): {
  container: HTMLDivElement
  unmount: () => void
} {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
    },
  })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
    )
  })
  return {
    container,
    unmount: () => {
      act(() => {
        root.unmount()
      })
      container.remove()
      client.clear()
    },
  }
}

describe('sortLeads (pure sorter)', () => {
  const leads: LeadListItem[] = [
    makeLead({ id: 'a', firstName: 'Alice', lastName: 'Zimmer', score: 30, dealValue: 1000 }),
    makeLead({ id: 'b', firstName: 'Bob', lastName: 'Young', score: 80, dealValue: null }),
    makeLead({ id: 'c', firstName: 'Carol', lastName: 'Xavier', score: 55, dealValue: '5000' }),
  ]

  it('sorts by name ascending', () => {
    const ids = sortLeads(leads, 'name', 'asc').map((l) => l.id)
    expect(ids).toEqual(['a', 'b', 'c'])
  })

  it('sorts by name descending', () => {
    const ids = sortLeads(leads, 'name', 'desc').map((l) => l.id)
    expect(ids).toEqual(['c', 'b', 'a'])
  })

  it('sorts by score numerically', () => {
    const ids = sortLeads(leads, 'score', 'asc').map((l) => l.id)
    expect(ids).toEqual(['a', 'c', 'b'])
  })

  it('sorts by dealValue, pushing nulls to the bottom of ascending order', () => {
    const ids = sortLeads(leads, 'dealValue', 'asc').map((l) => l.id)
    // nulls map to -Infinity, so they sort first in ascending order
    expect(ids[0]).toBe('b')
    expect(ids.slice(1)).toEqual(['a', 'c'])
  })

  it('does not mutate the input array', () => {
    const original = leads.map((l) => l.id)
    sortLeads(leads, 'score', 'desc')
    expect(leads.map((l) => l.id)).toEqual(original)
  })
})

describe('LeadTable', () => {
  beforeEach(() => {
    useFiltersStore.setState({ leads: {} })
    ;(globalThis as { fetch?: typeof fetch }).fetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch
  })

  it('renders the empty state when no leads match', () => {
    const { container, unmount } = mount(
      <LeadTable
        initialData={{
          data: [],
          pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
        }}
      />,
    )
    expect(container.textContent).toContain('No leads match the current filters')
    unmount()
  })

  it('renders provided initial rows with stage, assignee, and formatted score', () => {
    const { container, unmount } = mount(
      <LeadTable
        initialData={{
          data: [
            makeLead({
              id: 'lead-1',
              firstName: 'Ada',
              lastName: 'Lovelace',
              companyName: 'Analytical Engines',
              leadStatus: 'QUALIFIED',
              dealValue: '1500',
              currency: 'USD',
              score: 72,
              // The table shows the pipeline stage pill (not lead status),
              // so give this row a "Qualified" stage to assert on.
              stage: {
                id: 'stage-q',
                name: 'Qualified',
                order: 2,
                isClosedWon: false,
                isClosedLost: false,
              },
              assignedUser: { id: 'u1', name: 'Ops Rep', email: 'ops@example.com' },
            }),
          ],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }}
      />,
    )

    const text = container.textContent ?? ''
    expect(text).toContain('Ada Lovelace')
    expect(text).toContain('Analytical Engines')
    expect(text).toContain('Qualified')
    expect(text).toContain('72')
    expect(text).toContain('Ops Rep')
    expect(text).toContain('Showing 1 of 1 leads')
    unmount()
  })

  it('renders a link to each lead detail page', () => {
    const { container, unmount } = mount(
      <LeadTable
        initialData={{
          data: [makeLead({ id: 'lead-42', firstName: 'Grace', lastName: 'Hopper' })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }}
      />,
    )
    const link = container.querySelector('a[href="/leads/lead-42"]')
    expect(link).not.toBeNull()
    expect(link?.textContent).toContain('Grace Hopper')
    unmount()
  })
})
