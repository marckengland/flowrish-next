import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'

import { TeamRhythm, type TeamRhythmRepRow } from './team-rhythm'

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

describe('TeamRhythm', () => {
  it('renders the empty state when there are no reps', () => {
    const { container, unmount } = mount(<TeamRhythm reps={[]} />)
    expect(container.textContent ?? '').toContain('No team members to coach')
    unmount()
  })

  it('aggregates totals across reps and shows top 3 urgent actions per rep', () => {
    const reps: TeamRhythmRepRow[] = [
      {
        userId: 'u-1',
        name: 'Alice',
        email: 'alice@example.com',
        openActionCount: 4,
        overdueCount: 2,
        topUrgent: [
          {
            id: 't-1',
            title: 'Call Acme',
            priorityScore: 85,
            leadId: 'lead-a',
            leadName: 'Acme',
            isOverdue: true,
          },
          {
            id: 't-2',
            title: 'Demo Globex',
            priorityScore: 60,
            leadId: 'lead-b',
            leadName: 'Globex',
            isOverdue: false,
          },
        ],
      },
      {
        userId: 'u-2',
        name: 'Bob',
        email: null,
        openActionCount: 1,
        overdueCount: 0,
        topUrgent: [],
      },
    ]

    const { container, unmount } = mount(<TeamRhythm reps={reps} />)
    const text = container.textContent ?? ''

    // Team size + totals
    expect(text).toContain('Team size')
    expect(text).toContain('2')
    expect(text).toContain('Team overdue')
    // Per-rep rendering
    expect(text).toContain('Alice')
    expect(text).toContain('Bob')
    expect(text).toContain('Call Acme')
    expect(text).toContain('Demo Globex')
    expect(text).toContain('No urgent actions right now.')

    // Priority scores rendered
    expect(text).toContain('85')
    expect(text).toContain('60')

    // Urgent actions link to their leads
    expect(container.querySelector('a[href="/leads/lead-a"]')).not.toBeNull()
    expect(container.querySelector('a[href="/leads/lead-b"]')).not.toBeNull()

    unmount()
  })
})
