import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { KanbanCard, formatCurrency, fullName } from './kanban-card'
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

function mount(ui: React.JSX.Element): {
  container: HTMLDivElement
  unmount: () => void
} {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(ui)
  })
  return {
    container,
    unmount: () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

describe('fullName', () => {
  it('joins first and last name', () => {
    expect(fullName({ firstName: 'Ada', lastName: 'Lovelace' })).toBe(
      'Ada Lovelace',
    )
  })

  it('returns a fallback when both names are empty', () => {
    expect(fullName({ firstName: '', lastName: '' })).toBe('Unnamed lead')
  })

  it('handles single-name leads', () => {
    expect(fullName({ firstName: 'Grace', lastName: '' })).toBe('Grace')
  })
})

describe('formatCurrency', () => {
  it('formats numeric values with the given currency', () => {
    const out = formatCurrency(1234, 'USD')
    expect(out).toContain('1,234')
  })

  it('parses Prisma Decimal string values', () => {
    const out = formatCurrency('2500', 'USD')
    expect(out).toContain('2,500')
  })

  it('returns an em-dash for null / undefined / empty', () => {
    expect(formatCurrency(null, 'USD')).toBe('—')
    expect(formatCurrency(undefined, 'USD')).toBe('—')
    expect(formatCurrency('', 'USD')).toBe('—')
  })

  it('returns an em-dash for non-finite numbers', () => {
    expect(formatCurrency(Number.POSITIVE_INFINITY, 'USD')).toBe('—')
    expect(formatCurrency('not-a-number', 'USD')).toBe('—')
  })
})

describe('KanbanCard', () => {
  beforeEach(() => {
    useKanbanStore.setState({ draggingLeadId: null, dragOverStageId: null })
  })

  it('renders lead name, score, and deal value', () => {
    const { container, unmount } = mount(
      <KanbanCard
        lead={{
          id: 'lead-1',
          firstName: 'Ada',
          lastName: 'Lovelace',
          dealValue: '1500',
          currency: 'USD',
          score: 72,
          assignedUser: { id: 'u1', name: 'Ops Rep' },
        }}
      />,
    )

    const text = container.textContent ?? ''
    expect(text).toContain('Ada Lovelace')
    expect(text).toContain('72')
    expect(text).toContain('1,500')
    expect(text).toContain('Ops Rep')
    unmount()
  })

  it('links to the lead detail page', () => {
    const { container, unmount } = mount(
      <KanbanCard
        lead={{
          id: 'lead-42',
          firstName: 'Grace',
          lastName: 'Hopper',
          dealValue: null,
          currency: 'USD',
          score: 0,
        }}
      />,
    )
    const link = container.querySelector('a[href="/leads/lead-42"]')
    expect(link).not.toBeNull()
    expect(link?.textContent).toContain('Grace Hopper')
    unmount()
  })

  it('is not draggable by default (read-only view)', () => {
    const { container, unmount } = mount(
      <KanbanCard
        lead={{
          id: 'lead-1',
          firstName: 'Ada',
          lastName: 'Lovelace',
          dealValue: null,
          currency: 'USD',
          score: 0,
        }}
      />,
    )
    const draggableEl = container.querySelector('[data-lead-id="lead-1"]')
    expect(draggableEl?.getAttribute('draggable')).not.toBe('true')
    unmount()
  })

  it('is draggable when canMove is true and reports drag state', () => {
    const { container, unmount } = mount(
      <KanbanCard
        draggable
        lead={{
          id: 'lead-1',
          firstName: 'Ada',
          lastName: 'Lovelace',
          dealValue: null,
          currency: 'USD',
          score: 0,
        }}
      />,
    )
    const el = container.querySelector(
      '[data-lead-id="lead-1"]',
    ) as HTMLElement | null
    expect(el?.getAttribute('draggable')).toBe('true')
    expect(el?.getAttribute('aria-grabbed')).toBe('false')

    // Simulating a drag updates the shared store.
    act(() => {
      useKanbanStore.getState().startDrag('lead-1')
    })
    const after = container.querySelector(
      '[data-lead-id="lead-1"]',
    ) as HTMLElement | null
    expect(after?.getAttribute('aria-grabbed')).toBe('true')
    unmount()
  })
})
