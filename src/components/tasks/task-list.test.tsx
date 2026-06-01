import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { groupTasks, TaskList } from './task-list'
import type { TaskItem } from '@/hooks/use-tasks'

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/tasks',
}))

/**
 * Unit tests for the task list — covers overdue highlighting, sort
 * order preservation, empty/error/loading states, and the inline
 * "Complete" action.
 *
 * Validates: Requirements 18.1, 18.3, 18.4, 18.5
 */

function makeTask(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: 'task-1',
    title: 'Follow up with Ada',
    description: null,
    priority: 'MEDIUM',
    dueDate: '2100-01-01T12:00:00.000Z',
    isComplete: false,
    completedAt: null,
    leadId: 'lead-1',
    assigneeId: 'user-1',
    organizationId: 'org-1',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    isOverdue: false,
    lead: { id: 'lead-1', firstName: 'Ada', lastName: 'Lovelace' },
    assignee: { id: 'user-1', name: 'Grace Hopper', email: 'grace@example.com' },
    ...overrides,
  }
}

function mount(ui: React.JSX.Element): {
  container: HTMLDivElement
  unmount: () => void
  queryClient: QueryClient
} {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
  const root = createRoot(container)
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
    )
  })
  return {
    container,
    queryClient,
    unmount: () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

describe('groupTasks', () => {
  it('preserves server-provided dueDate ordering for open tasks', () => {
    const a = makeTask({ id: 'a', dueDate: '2100-01-01T00:00:00.000Z' })
    const b = makeTask({ id: 'b', dueDate: '2100-02-01T00:00:00.000Z' })
    const c = makeTask({ id: 'c', dueDate: '2100-03-01T00:00:00.000Z' })
    const result = groupTasks([a, b, c])
    expect(result.map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })

  it('pushes completed tasks to the bottom of the list', () => {
    const open1 = makeTask({ id: 'open-1' })
    const done = makeTask({ id: 'done', isComplete: true })
    const open2 = makeTask({ id: 'open-2' })
    const result = groupTasks([open1, done, open2])
    expect(result.map((t) => t.id)).toEqual(['open-1', 'open-2', 'done'])
  })

  it('keeps relative order within each group (stable partition)', () => {
    const tasks = [
      makeTask({ id: 'a', isComplete: true }),
      makeTask({ id: 'b' }),
      makeTask({ id: 'c', isComplete: true }),
      makeTask({ id: 'd' }),
    ]
    expect(groupTasks(tasks).map((t) => t.id)).toEqual(['b', 'd', 'a', 'c'])
  })
})

describe('TaskList', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    document.body.innerHTML = ''
  })

  it('renders the empty state when no tasks match the filters', () => {
    const { container, unmount } = mount(
      <TaskList filters={{}} initialTasks={[]} />,
    )
    expect(container.textContent).toContain('No tasks match')
    unmount()
  })

  it('renders task titles, priority badges, and due dates', () => {
    const tasks = [
      makeTask({
        id: 't1',
        title: 'Call with Ada',
        priority: 'HIGH',
        dueDate: '2100-01-15T10:00:00.000Z',
      }),
    ]
    const { container, unmount } = mount(
      <TaskList filters={{}} initialTasks={tasks} />,
    )
    expect(container.textContent).toContain('Call with Ada')
    expect(container.textContent).toContain('HIGH')
    // Some wording near "Due …" should be present.
    expect(container.textContent).toMatch(/Due/)
    unmount()
  })

  it('flags overdue tasks with an Overdue badge and destructive accent', () => {
    const tasks = [
      makeTask({
        id: 't-overdue',
        title: 'Past due task',
        isOverdue: true,
        dueDate: '2000-01-01T00:00:00.000Z',
      }),
    ]
    const { container, unmount } = mount(
      <TaskList filters={{}} initialTasks={tasks} />,
    )
    const article = container.querySelector(
      'article[data-overdue="true"]',
    ) as HTMLElement | null
    expect(article).not.toBeNull()
    expect(container.textContent).toContain('Overdue')
    unmount()
  })

  it('does not render an overdue badge for non-overdue tasks', () => {
    const tasks = [makeTask({ id: 't-ok', isOverdue: false })]
    const { container, unmount } = mount(
      <TaskList filters={{}} initialTasks={tasks} />,
    )
    const article = container.querySelector(
      'article[data-overdue="true"]',
    ) as HTMLElement | null
    expect(article).toBeNull()
    expect(container.textContent).not.toContain('Overdue')
    unmount()
  })

  it('renders a Completed timestamp in place of the Complete button for completed tasks', () => {
    const tasks = [
      makeTask({
        id: 't-done',
        isComplete: true,
        completedAt: '2024-06-01T12:00:00.000Z',
      }),
    ]
    const { container, unmount } = mount(
      <TaskList filters={{}} initialTasks={tasks} />,
    )
    const completeButton = Array.from(
      container.querySelectorAll('button'),
    ).find((b) => b.textContent?.includes('Complete'))
    expect(completeButton).toBeUndefined()
    expect(container.textContent).toMatch(/Completed/)
    unmount()
  })

  it('fires PATCH /api/tasks/[id] with isComplete:true when the Complete button is clicked', async () => {
    // Route the mock by URL so the PATCH response and the refetched list
    // after cache invalidation return shapes that match each endpoint.
    const completedTask = {
      ...makeTask({ id: 'task-1', isComplete: true }),
      completedAt: '2024-06-01T12:00:00.000Z',
    }
    const fetchMock = vi.fn(
      async (
        input: RequestInfo | URL,
        _init?: RequestInit,
      ): Promise<Response> => {
        const url = String(input)
        // List refetch after invalidation — return an array.
        if (url.startsWith('/api/tasks') && !url.includes('/api/tasks/')) {
          return new Response(JSON.stringify({ data: [completedTask] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        // PATCH response — single task object.
        return new Response(JSON.stringify({ data: completedTask }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      },
    )
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch

    const tasks = [makeTask({ id: 'task-1' })]
    const { container, unmount } = mount(
      <TaskList filters={{}} initialTasks={tasks} />,
    )

    const btn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Complete'),
    )
    expect(btn).toBeDefined()

    await act(async () => {
      btn?.click()
    })

    // Flush microtasks so the fetch promise resolves into the mutation.
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        await Promise.resolve()
      })
    }

    // The first call must be the PATCH; subsequent calls may be the
    // list refetch triggered by cache invalidation.
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('/api/tasks/task-1')
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(String(init?.body))).toEqual({ isComplete: true })

    unmount()
  })

  it('hides the Complete button when canComplete is false', () => {
    const tasks = [makeTask({ id: 't1' })]
    const { container, unmount } = mount(
      <TaskList filters={{}} initialTasks={tasks} canComplete={false} />,
    )
    const btn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Complete'),
    )
    expect(btn).toBeUndefined()
    unmount()
  })
})
