import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LeadViewControls } from './lead-view-controls'
import { useFiltersStore } from '@/stores/filters'

beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); useFiltersStore.setState({ leads: {} })
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => new Response(JSON.stringify({ data: [], scope: { organizationId: init.headers['x-flowrish-workspace'], userId: 'user' } }))))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear(); useFiltersStore.setState({ leads: {} }) })
it('keeps active filters in an owner/workspace key and never imports an unowned legacy selection', async () => {
  localStorage.setItem('flowrish:leads:filters', JSON.stringify({ search: 'Legacy private search' }))
  localStorage.setItem('flowrish:leads:filters:org:user', JSON.stringify({ search: 'My restored search' }))
  const ui = render(<LeadViewControls organizationId="org" userId="user" pipelineId="pipeline" />)
  await act(async () => { vi.advanceTimersByTime(400) })
  expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveValue('My restored search')
  ui.rerender(<LeadViewControls organizationId="other" userId="user" pipelineId="pipeline" />)
  await act(async () => { vi.advanceTimersByTime(400) })
  expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveValue(''); expect(useFiltersStore.getState().leads).toEqual({})
  expect(JSON.parse(localStorage.getItem('flowrish:leads:filters:org:user')!)).toEqual({ search: 'My restored search' })
})
it('blocks saving while search is debouncing and applying a view cannot resurrect the previous search', async () => {
  render(<LeadViewControls organizationId="org" userId="user" pipelineId="pipeline" />)
  await act(async () => { vi.advanceTimersByTime(400) })
  fireEvent.change(screen.getByLabelText('View name'), { target: { value: 'My search' } }); fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), { target: { value: 'First' } })
  expect(screen.getByRole('button', { name: 'Save as new view' })).toBeDisabled()
  await act(async () => { vi.advanceTimersByTime(400) })
  expect(screen.getByRole('button', { name: 'Save as new view' })).toBeEnabled()
  act(() => useFiltersStore.getState().setLeadFilters({ search: 'Applied search', leadStatus: 'NEW' }))
  await act(async () => { vi.advanceTimersByTime(400) })
  expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveValue('Applied search'); expect(useFiltersStore.getState().leads).toEqual({ search: 'Applied search', leadStatus: 'NEW' })
})

it.each(['Acme', ''])('allows settled whitespace-normalized search after %j without getting stuck', async initial => {
  render(<LeadViewControls organizationId="org" userId="user" pipelineId="pipeline" />)
  await act(async () => { vi.advanceTimersByTime(400) })
  fireEvent.change(screen.getByLabelText('View name'), { target: { value: 'Whitespace view' } })
  if (initial) { fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), { target: { value: initial } }); await act(async () => { vi.advanceTimersByTime(400) }) }
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), { target: { value: `${initial} ` } })
  await act(async () => { vi.advanceTimersByTime(400) })
  expect(screen.getByRole('button', { name: 'Save as new view' })).toBeEnabled()
  expect(useFiltersStore.getState().leads).toEqual(initial ? { search: initial } : {})
})
