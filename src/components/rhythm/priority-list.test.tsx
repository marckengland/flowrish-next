import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'

import {
  PriorityList,
  type PriorityActionRow,
} from './priority-list'

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

function makeAction(overrides: Partial<PriorityActionRow> = {}): PriorityActionRow {
  return {
    id: 'task-1',
    title: 'Follow up with Acme',
    description: null,
    dueDate: new Date('2099-01-01T00:00:00Z'),
    priorityScore: 40,
    priority: 'MEDIUM',
    isOverdue: false,
    leadId: 'lead-1',
    leadName: 'Jane Doe',
    leadScore: 72,
    dealValue: 25_000,
    currency: 'USD',
    ...overrides,
  }
}

describe('PriorityList', () => {
  it('renders the empty state when there are no actions', () => {
    const { container, unmount } = mount(<PriorityList actions={[]} />)
    const text = container.textContent ?? ''
    expect(text).toContain('Open actions')
    expect(text).toContain('Nothing to do right now')
    unmount()
  })

  it('shows open/overdue/due-today counts derived from actions', () => {
    const today = new Date()
    const past = new Date(today.getTime() - 60 * 60 * 1000)
    const actions: PriorityActionRow[] = [
      makeAction({
        id: 't-1',
        title: 'Overdue + Due Today',
        dueDate: past,
        isOverdue: true,
        priorityScore: 85,
      }),
      makeAction({
        id: 't-2',
        title: 'Due Today (future hour)',
        dueDate: today,
        isOverdue: false,
        priorityScore: 50,
      }),
      makeAction({
        id: 't-3',
        title: 'Far future',
        dueDate: new Date('2099-12-31T00:00:00Z'),
        isOverdue: false,
        priorityScore: 20,
      }),
    ]

    const { container, unmount } = mount(<PriorityList actions={actions} />)
    const text = container.textContent ?? ''
    // 3 total open actions
    expect(text).toContain('Open actions')
    expect(text).toContain('3')
    // At least one overdue
    expect(text).toContain('Overdue')
    // Task titles render
    expect(text).toContain('Overdue + Due Today')
    expect(text).toContain('Far future')
    unmount()
  })

  it('surfaces deal value, lead score, and links to each lead', () => {
    const action = makeAction({
      dealValue: 12_500,
      currency: 'USD',
      leadScore: 88,
      leadId: 'lead-xyz',
      leadName: 'Globex Corp',
    })
    const { container, unmount } = mount(<PriorityList actions={[action]} />)

    const leadLinks = Array.from(
      container.querySelectorAll('a[href="/leads/lead-xyz"]'),
    )
    expect(leadLinks.length).toBeGreaterThan(0)
    const text = container.textContent ?? ''
    expect(text).toContain('Score 88')
    // Currency is rendered via Intl; the dollar sign + 12,500 digits should appear.
    expect(text).toContain('12,500')
    unmount()
  })

  it('marks HIGH priority actions explicitly in the row meta', () => {
    const action = makeAction({
      priority: 'HIGH',
      priorityScore: 90,
      title: 'Urgent callback',
    })
    const { container, unmount } = mount(<PriorityList actions={[action]} />)
    expect(container.textContent ?? '').toContain('High priority')
    unmount()
  })
})
