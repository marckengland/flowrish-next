import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'

import { ActivityTimeline } from './activity-timeline'
import type { ActivityItem } from '@/hooks/use-activities'

/**
 * Component-level tests for the activity timeline.
 *
 * `initialActivities` is always supplied so the timeline renders from
 * cache synchronously without needing a live fetch stub. That keeps the
 * tests focused on rendering and type-specific formatting.
 *
 * Validates: Requirements 5.1, 5.2, 5.4
 */

function mount(ui: React.JSX.Element): {
  container: HTMLDivElement
  unmount: () => void
} {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
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
    },
  }
}

function makeActivity(overrides: Partial<ActivityItem>): ActivityItem {
  return {
    id: 'activity-1',
    leadId: 'lead-1',
    createdById: 'user-1',
    type: 'NOTE',
    notes: null,
    callDate: null,
    callDuration: null,
    meetingDate: null,
    attendees: null,
    emailMessageId: null,
    createdAt: '2025-01-01T12:00:00Z',
    ...overrides,
  }
}

describe('ActivityTimeline', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders the empty state when no activities are present', () => {
    const { container, unmount } = mount(
      <ActivityTimeline leadId="lead-1" initialActivities={[]} />,
    )
    expect(container.textContent).toContain('No activities yet')
    unmount()
  })

  it('renders each activity with the correct type label and notes', () => {
    const activities: ActivityItem[] = [
      makeActivity({
        id: 'a1',
        type: 'NOTE',
        notes: 'Had a great chat with the CFO',
      }),
      makeActivity({
        id: 'a2',
        type: 'CALL',
        callDate: '2025-01-03T10:00:00Z',
        callDuration: 180,
        notes: 'Follow-up needed next week',
      }),
      makeActivity({
        id: 'a3',
        type: 'MEETING',
        meetingDate: '2025-01-05T14:30:00Z',
        attendees: JSON.stringify(['Ada Lovelace', 'Alan Turing']),
        notes: 'Discussed pricing',
      }),
    ]

    const { container, unmount } = mount(
      <ActivityTimeline leadId="lead-1" initialActivities={activities} />,
    )

    const text = container.textContent ?? ''
    expect(text).toContain('Note')
    expect(text).toContain('Had a great chat with the CFO')
    expect(text).toContain('Call')
    expect(text).toContain('Follow-up needed next week')
    expect(text).toContain('Meeting')
    expect(text).toContain('Ada Lovelace')
    expect(text).toContain('Alan Turing')
    unmount()
  })

  it('renders an ordered list with one list item per activity', () => {
    const activities: ActivityItem[] = [
      makeActivity({ id: 'a1', type: 'NOTE' }),
      makeActivity({ id: 'a2', type: 'EMAIL' }),
    ]

    const { container, unmount } = mount(
      <ActivityTimeline leadId="lead-1" initialActivities={activities} />,
    )

    const list = container.querySelector('ol')
    expect(list).not.toBeNull()
    expect(list?.getAttribute('aria-label')).toBe('Activity timeline')
    expect(list?.querySelectorAll('li').length).toBe(2)
    unmount()
  })
})
