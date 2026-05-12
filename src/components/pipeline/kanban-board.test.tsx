import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import {
  KanbanBoard,
  groupLeadsByStage,
  type KanbanStage,
} from './kanban-board'
import type { LeadListItem } from '@/hooks/use-leads'
import { useKanbanStore } from '@/stores/kanban'

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
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
    stage: {
      id: 'stage-1',
      name: 'New',
      order: 1,
      isClosedWon: false,
      isClosedLost: false,
    },
    assignedUser: null,
    ...overrides,
  }
}

function mount(ui: React.JSX.Element): {
  container: HTMLDivElement
  unmount: () => void
  client: QueryClient
} {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
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
    client,
    unmount: () => {
      act(() => {
        root.unmount()
      })
      container.remove()
      client.clear()
    },
  }
}

const STAGES: KanbanStage[] = [
  { id: 's-new', name: 'New', order: 1, isClosedWon: false, isClosedLost: false },
  { id: 's-qual', name: 'Qualified', order: 2, isClosedWon: false, isClosedLost: false },
  { id: 's-won', name: 'Closed Won', order: 3, isClosedWon: true, isClosedLost: false },
]

describe('groupLeadsByStage', () => {
  it('creates an empty bucket for every stage', () => {
    const map = groupLeadsByStage(STAGES, [])
    expect(map.size).toBe(STAGES.length)
    for (const stage of STAGES) {
      expect(map.get(stage.id)).toEqual([])
    }
  })

  it('routes each lead to the bucket for its stageId', () => {
    const leads = [
      makeLead({ id: 'a', stageId: 's-new' }),
      makeLead({ id: 'b', stageId: 's-new' }),
      makeLead({ id: 'c', stageId: 's-qual' }),
    ]
    const map = groupLeadsByStage(STAGES, leads)
    expect(map.get('s-new')?.map((l) => l.id)).toEqual(['a', 'b'])
    expect(map.get('s-qual')?.map((l) => l.id)).toEqual(['c'])
    expect(map.get('s-won')).toEqual([])
  })

  it('ignores leads whose stageId is not in the provided stage list', () => {
    const leads = [
      makeLead({ id: 'x', stageId: 's-ghost' }),
      makeLead({ id: 'y', stageId: 's-new' }),
    ]
    const map = groupLeadsByStage(STAGES, leads)
    expect(map.get('s-new')?.map((l) => l.id)).toEqual(['y'])
    expect(map.size).toBe(STAGES.length)
  })

  it('projects lead fields down to the card shape', () => {
    const leads = [
      makeLead({
        id: 'a',
        firstName: 'Ada',
        lastName: 'Lovelace',
        dealValue: '1000',
        currency: 'USD',
        score: 42,
        stageId: 's-new',
        assignedUser: {
          id: 'u1',
          name: 'Ops Rep',
          email: 'ops@example.com',
        },
      }),
    ]
    const card = groupLeadsByStage(STAGES, leads).get('s-new')?.[0]
    expect(card).toEqual({
      id: 'a',
      firstName: 'Ada',
      lastName: 'Lovelace',
      dealValue: '1000',
      currency: 'USD',
      score: 42,
      assignedUser: { id: 'u1', name: 'Ops Rep' },
    })
  })
})

describe('KanbanBoard', () => {
  beforeEach(() => {
    useKanbanStore.setState({ draggingLeadId: null, dragOverStageId: null })
    ;(globalThis as { fetch?: typeof fetch }).fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [],
          pagination: { page: 1, pageSize: 200, total: 0, totalPages: 1 },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    ) as unknown as typeof fetch
  })

  it('renders every stage column even when there are no leads (empty board)', () => {
    const { container, unmount } = mount(
      <KanbanBoard
        stages={STAGES}
        initialLeads={[]}
        totalLeads={0}
        canMove={false}
      />,
    )
    const columns = container.querySelectorAll('[data-stage-id]')
    expect(columns.length).toBe(STAGES.length)
    const text = container.textContent ?? ''
    expect(text).toContain('New')
    expect(text).toContain('Qualified')
    expect(text).toContain('Closed Won')
    // Every column shows the "No leads" empty state
    const emptyStates = Array.from(
      container.querySelectorAll('[data-stage-id] p'),
    ).filter((el) => el.textContent?.trim() === 'No leads')
    expect(emptyStates.length).toBe(STAGES.length)
    unmount()
  })

  it('places leads under the column matching their stageId', () => {
    const { container, unmount } = mount(
      <KanbanBoard
        stages={STAGES}
        initialLeads={[
          makeLead({
            id: 'lead-n',
            firstName: 'New',
            lastName: 'Lead',
            stageId: 's-new',
          }),
          makeLead({
            id: 'lead-q',
            firstName: 'Qualified',
            lastName: 'Lead',
            stageId: 's-qual',
          }),
        ]}
        totalLeads={2}
        canMove={false}
      />,
    )

    const newColumn = container.querySelector('[data-stage-id="s-new"]')
    const qualColumn = container.querySelector('[data-stage-id="s-qual"]')
    expect(newColumn?.textContent).toContain('New Lead')
    expect(qualColumn?.textContent).toContain('Qualified Lead')
    unmount()
  })

  it('renders cards as non-draggable when canMove is false', () => {
    const { container, unmount } = mount(
      <KanbanBoard
        stages={STAGES}
        initialLeads={[makeLead({ id: 'lead-1', stageId: 's-new' })]}
        totalLeads={1}
        canMove={false}
      />,
    )
    const card = container.querySelector('[data-lead-id="lead-1"]')
    expect(card?.getAttribute('draggable')).not.toBe('true')
    unmount()
  })

  it('renders cards as draggable when canMove is true', () => {
    const { container, unmount } = mount(
      <KanbanBoard
        stages={STAGES}
        initialLeads={[makeLead({ id: 'lead-1', stageId: 's-new' })]}
        totalLeads={1}
        canMove
      />,
    )
    const card = container.querySelector('[data-lead-id="lead-1"]')
    expect(card?.getAttribute('draggable')).toBe('true')
    unmount()
  })

  it('displays lead count per column', () => {
    const { container, unmount } = mount(
      <KanbanBoard
        stages={STAGES}
        initialLeads={[
          makeLead({ id: 'a', stageId: 's-new' }),
          makeLead({ id: 'b', stageId: 's-new' }),
          makeLead({ id: 'c', stageId: 's-qual' }),
        ]}
        totalLeads={3}
        canMove={false}
      />,
    )
    const newColumn = container.querySelector('[data-stage-id="s-new"]')
    const qualColumn = container.querySelector('[data-stage-id="s-qual"]')
    const wonColumn = container.querySelector('[data-stage-id="s-won"]')
    expect(
      newColumn?.querySelector('[aria-label="2 leads"]')?.textContent,
    ).toBe('2')
    expect(
      qualColumn?.querySelector('[aria-label="1 leads"]')?.textContent,
    ).toBe('1')
    expect(
      wonColumn?.querySelector('[aria-label="0 leads"]')?.textContent,
    ).toBe('0')
    unmount()
  })

  it('fires a move mutation when a card is dropped on a different column', async () => {
    type FetchArgs = [RequestInfo | URL, RequestInit | undefined]
    const fetchMock = vi.fn<(...args: FetchArgs) => Promise<Response>>(
      async (input, init) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (init?.method === 'PATCH' && /\/api\/leads\/.+\/move/.test(url)) {
          return new Response(JSON.stringify({ data: {} }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        return new Response(
          JSON.stringify({
            data: [],
            pagination: { page: 1, pageSize: 200, total: 0, totalPages: 1 },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        )
      },
    )
    ;(globalThis as { fetch?: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch

    const { container, unmount } = mount(
      <KanbanBoard
        stages={STAGES}
        initialLeads={[
          makeLead({ id: 'lead-1', firstName: 'Ada', stageId: 's-new' }),
        ]}
        totalLeads={1}
        canMove
      />,
    )

    const targetColumn = container.querySelector(
      '[data-stage-id="s-qual"]',
    ) as HTMLElement

    // Simulate HTML5 drag-and-drop: populate the Zustand store as the
    // card would, then dispatch drop on the target column.
    act(() => {
      useKanbanStore.getState().startDrag('lead-1')
    })

    const dataTransfer = {
      getData: () => 'lead-1',
      setData: () => undefined,
      effectAllowed: 'move',
      dropEffect: 'move',
    }
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(dropEvent, 'dataTransfer', { value: dataTransfer })
    act(() => {
      targetColumn.dispatchEvent(dropEvent)
    })

    // Wait a microtask so TanStack Query schedules the mutation.
    await act(async () => {
      await Promise.resolve()
    })

    const moveCalls = fetchMock.mock.calls.filter((call) => {
      const [url, init] = call
      const u = typeof url === 'string' ? url : url.toString()
      return u.includes('/api/leads/lead-1/move') && init?.method === 'PATCH'
    })
    expect(moveCalls.length).toBe(1)
    const body = JSON.parse(moveCalls[0][1]?.body as string)
    expect(body).toEqual({ toStageId: 's-qual' })

    unmount()
  })

  it('does not fire a move mutation when dropped on the same column', async () => {
    type FetchArgs = [RequestInfo | URL, RequestInit | undefined]
    const fetchMock = vi.fn<(...args: FetchArgs) => Promise<Response>>(
      async () =>
        new Response(
          JSON.stringify({
            data: [],
            pagination: { page: 1, pageSize: 200, total: 0, totalPages: 1 },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
    )
    ;(globalThis as { fetch?: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch

    const { container, unmount } = mount(
      <KanbanBoard
        stages={STAGES}
        initialLeads={[makeLead({ id: 'lead-1', stageId: 's-new' })]}
        totalLeads={1}
        canMove
      />,
    )

    const sameColumn = container.querySelector(
      '[data-stage-id="s-new"]',
    ) as HTMLElement

    act(() => {
      useKanbanStore.getState().startDrag('lead-1')
    })
    const dataTransfer = {
      getData: () => 'lead-1',
      setData: () => undefined,
      effectAllowed: 'move',
      dropEffect: 'move',
    }
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(dropEvent, 'dataTransfer', { value: dataTransfer })
    act(() => {
      sameColumn.dispatchEvent(dropEvent)
    })
    await act(async () => {
      await Promise.resolve()
    })

    const moveCalls = fetchMock.mock.calls.filter((call) => {
      const [url, init] = call
      const u = typeof url === 'string' ? url : url.toString()
      return u.includes('/move') && init?.method === 'PATCH'
    })
    expect(moveCalls.length).toBe(0)
    unmount()
  })
})
