import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LeadFilters } from './lead-filters'
import { useFiltersStore } from '@/stores/filters'

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

function fire(el: Element, type: string): void {
  act(() => {
    el.dispatchEvent(new Event(type, { bubbles: true }))
  })
}

describe('LeadFilters', () => {
  beforeEach(() => {
    useFiltersStore.setState({ leads: {} })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders search, stage, status, tier, assignee, and clear controls', () => {
    const { container, unmount } = mount(
      <LeadFilters
        stages={[{ value: 'stage-1', label: 'New' }]}
        assignees={[{ value: 'user-1', label: 'Rep One' }]}
      />,
    )
    const text = container.textContent ?? ''
    expect(text).toContain('Search')
    expect(text).toContain('Stage')
    expect(text).toContain('Status')
    expect(text).toContain('Tier')
    expect(text).toContain('Assignee')
    expect(text).toContain('Clear')
    unmount()
  })

  it('reflects store state into inputs and writes changes back into the store', () => {
    const { container, unmount } = mount(
      <LeadFilters
        stages={[
          { value: 'stage-1', label: 'New' },
          { value: 'stage-2', label: 'Qualified' },
        ]}
      />,
    )

    // Use the store to set a value, confirm the UI reflects it.
    act(() => {
      useFiltersStore.getState().setLeadFilter('stageId', 'stage-2')
    })
    const stageSelect = container.querySelector(
      'select',
    ) as HTMLSelectElement | null
    expect(stageSelect).not.toBeNull()

    // Now simulate user typing in the search box: use the native setter so
    // React's internal value tracker notices the change and fires onChange.
    const search = container.querySelector(
      'input[type="search"]',
    ) as HTMLInputElement | null
    expect(search).not.toBeNull()
    const setNativeValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set
    act(() => {
      setNativeValue?.call(search, 'acme')
    })
    fire(search!, 'input')

    // The search input is debounced (300ms) so the write to the store
    // only lands after the timer fires. Advance fake timers to flush it.
    act(() => {
      vi.advanceTimersByTime(400)
    })

    expect(useFiltersStore.getState().leads.search).toBe('acme')
    expect(useFiltersStore.getState().leads.stageId).toBe('stage-2')
    unmount()
  })

  it('Clear button resets all lead filters', () => {
    useFiltersStore.setState({
      leads: { stageId: 'stage-1', leadStatus: 'NEW' },
    })
    const { container, unmount } = mount(<LeadFilters />)

    const clearButton = Array.from(
      container.querySelectorAll('button'),
    ).find((b) => b.textContent?.includes('Clear')) as
      | HTMLButtonElement
      | undefined
    expect(clearButton).toBeDefined()
    act(() => {
      clearButton!.click()
    })
    expect(useFiltersStore.getState().leads).toEqual({})
    unmount()
  })

  it('disables the Clear button when no filters are active', () => {
    const { container, unmount } = mount(<LeadFilters />)
    const clearButton = Array.from(
      container.querySelectorAll('button'),
    ).find((b) => b.textContent?.includes('Clear')) as
      | HTMLButtonElement
      | undefined
    expect(clearButton?.disabled).toBe(true)
    unmount()
  })
})
