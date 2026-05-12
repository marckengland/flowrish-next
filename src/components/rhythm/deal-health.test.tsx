import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'

import { DealHealth, type DealHealthRow } from './deal-health'

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

const emptyGapSummary = {
  noRecentActivity: 0,
  noFutureMeeting: 0,
  singleThreaded: 0,
}

describe('DealHealth', () => {
  it('renders the empty state when there are no leads to score', () => {
    const { container, unmount } = mount(
      <DealHealth
        leads={[]}
        summary={{ healthy: 0, atRisk: 0, critical: 0 }}
        gapSummary={emptyGapSummary}
      />,
    )
    const text = container.textContent ?? ''
    expect(text).toContain('Healthy')
    expect(text).toContain('At risk')
    expect(text).toContain('Critical')
    expect(text).toContain('No open deals to score')
    unmount()
  })

  it('shows health summary counts in the metric cards', () => {
    const { container, unmount } = mount(
      <DealHealth
        leads={[]}
        summary={{ healthy: 12, atRisk: 5, critical: 2 }}
        gapSummary={{
          noRecentActivity: 4,
          noFutureMeeting: 6,
          singleThreaded: 3,
        }}
      />,
    )
    const text = container.textContent ?? ''
    expect(text).toContain('12')
    expect(text).toContain('5')
    expect(text).toContain('2')
    expect(text).toContain('No recent activity')
    expect(text).toContain('Single-threaded')
    unmount()
  })

  it('renders lead rows with classification, score, and gap chips', () => {
    const leads: DealHealthRow[] = [
      {
        leadId: 'lead-1',
        leadName: 'Acme Corp',
        engagementScore: 18,
        health: 'Critical',
        dealValue: 50_000,
        currency: 'USD',
        gaps: ['no_recent_activity', 'single_threaded'],
      },
      {
        leadId: 'lead-2',
        leadName: 'Globex',
        engagementScore: 48,
        health: 'At Risk',
        dealValue: null,
        currency: 'USD',
        gaps: ['no_future_meeting'],
      },
    ]
    const { container, unmount } = mount(
      <DealHealth
        leads={leads}
        summary={{ healthy: 0, atRisk: 1, critical: 1 }}
        gapSummary={{
          noRecentActivity: 1,
          noFutureMeeting: 1,
          singleThreaded: 1,
        }}
      />,
    )
    const text = container.textContent ?? ''
    expect(text).toContain('Acme Corp')
    expect(text).toContain('Globex')
    expect(text).toContain('No recent activity')
    expect(text).toContain('Single-threaded')
    expect(text).toContain('No future meeting')
    expect(text).toContain('No deal value set')

    const link = container.querySelector('a[href="/leads/lead-1"]')
    expect(link).not.toBeNull()
    unmount()
  })
})
