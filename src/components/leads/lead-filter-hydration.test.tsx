import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LeadFilters } from './lead-filters'
const LEADS_FILTERS_KEY = 'flowrish:leads:filters'
import { useFiltersStore } from '@/stores/filters'
beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  useFiltersStore.setState({ leads: {} })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  localStorage.clear()
  useFiltersStore.setState({ leads: {} })
})
it('restores a saved search and stage without overwriting either on mount', async () => {
  localStorage.setItem(
    LEADS_FILTERS_KEY,
    JSON.stringify({ search: 'Saved prospect', stageId: 'stage' }),
  )
  render(<LeadFilters stages={[{ value: 'stage', label: 'New' }]} />)
  await act(async () => {
    vi.advanceTimersByTime(400)
  })
  expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveValue(
    'Saved prospect',
  )
  expect(useFiltersStore.getState().leads).toEqual({
    search: 'Saved prospect',
    stageId: 'stage',
  })
  expect(JSON.parse(localStorage.getItem(LEADS_FILTERS_KEY)!)).toEqual({
    search: 'Saved prospect',
    stageId: 'stage',
  })
})
it('keeps typing responsive and clearing cannot resurrect an old debounced search', async () => {
  render(<LeadFilters />)
  const input = screen.getByRole('searchbox', { name: 'Search' })
  fireEvent.change(input, { target: { value: 'First' } })
  await act(async () => {
    vi.advanceTimersByTime(400)
  })
  expect(useFiltersStore.getState().leads.search).toBe('First')
  fireEvent.change(input, { target: { value: 'Second' } })
  fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }))
  await act(async () => {
    vi.advanceTimersByTime(400)
  })
  expect(input).toHaveValue('')
  expect(useFiltersStore.getState().leads).toEqual({})
})
