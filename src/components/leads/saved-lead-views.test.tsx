import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SavedLeadViews } from './saved-lead-views'
import { useFiltersStore } from '@/stores/filters'
const id = '11111111-1111-4111-8111-111111111111'
const row = { id, name: 'New prospects', filters: { leadStatus: 'NEW' }, revision: 1, updatedAt: '2026-11-05T00:00:00.000Z' }
const scope = { organizationId: 'org', userId: 'user' }
const props = { ...scope, stages: [], assignees: [], filtersReady: true }
let rows: typeof row[], writes: Array<{ method: string; body: any }>
const fetchMock = vi.fn()
const reply = (data: unknown, status = 200) => new Response(JSON.stringify({ data, scope }), { status, headers: { 'content-type': 'application/json' } })
beforeEach(() => {
  rows = [row]; writes = []; useFiltersStore.setState({ leads: {} }); fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET') return reply(rows)
    const body = JSON.parse(init?.body as string); writes.push({ method, body })
    if (method === 'DELETE') return reply({ deleted: true })
    return reply({ ...row, ...body, id: method === 'POST' ? body.id : id, revision: method === 'POST' ? 1 : 2, expectedRevision: undefined })
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useFiltersStore.setState({ leads: {} }) })
async function choose() { await screen.findByRole('option', { name: 'New prospects' }); fireEvent.change(screen.getByLabelText('Saved lead view'), { target: { value: id } }) }
it('loads personal views without applying filters, then applies only on explicit request', async () => {
  useFiltersStore.setState({ leads: { search: 'Keep current' } }); render(<SavedLeadViews {...props} />); await choose()
  expect(useFiltersStore.getState().leads).toEqual({ search: 'Keep current' }); expect(writes).toEqual([])
  fireEvent.click(screen.getByRole('button', { name: 'Apply view' })); expect(useFiltersStore.getState().leads).toEqual({ leadStatus: 'NEW' }); expect(writes).toEqual([])
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store', headers: expect.objectContaining({ 'x-flowrish-workspace': 'org' }) })
})
it('creates, renames, replaces filters and confirms deletion using explicit versioned actions', async () => {
  render(<SavedLeadViews {...props} />); await choose(); fireEvent.change(screen.getByLabelText('View name'), { target: { value: 'Qualified' } }); fireEvent.click(screen.getByRole('button', { name: 'Rename view' })); await waitFor(() => expect(writes).toHaveLength(1)); expect(writes[0]).toEqual({ method: 'PATCH', body: { expectedRevision: 1, name: 'Qualified' } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Replace saved filters' })).toBeEnabled()); fireEvent.click(screen.getByRole('button', { name: 'Replace saved filters' })); await waitFor(() => expect(writes).toHaveLength(2)); expect(writes[1].body).toEqual({ expectedRevision: 2, filters: {} })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Delete saved view' })).toBeEnabled()); fireEvent.click(screen.getByRole('button', { name: 'Delete saved view' })); expect(writes).toHaveLength(2); fireEvent.click(screen.getByRole('button', { name: 'Confirm delete saved view' })); await waitFor(() => expect(writes).toHaveLength(3)); expect(writes[2].method).toBe('DELETE')
  fireEvent.change(screen.getByLabelText('View name'), { target: { value: 'Another' } }); await waitFor(() => expect(screen.getByRole('button', { name: 'Save as new view' })).toBeEnabled()); fireEvent.click(screen.getByRole('button', { name: 'Save as new view' })); await waitFor(() => expect(writes).toHaveLength(4)); expect(writes[3]).toMatchObject({ method: 'POST', body: { name: 'Another', filters: {} } }); expect(writes[3].body.id).toMatch(/^[a-f\d-]{36}$/i)
})
it('refreshes cross-device metadata on focus without replacing filters or an in-progress edit', async () => {
  render(<SavedLeadViews {...props} />); await choose(); fireEvent.change(screen.getByLabelText('View name'), { target: { value: 'My unfinished rename' } }); useFiltersStore.setState({ leads: { search: 'Keep' } }); rows = [{ ...row, name: 'Other device', revision: 2 }]
  fireEvent.focus(window); await screen.findByRole('option', { name: 'Other device' }); expect(screen.getByLabelText('View name')).toHaveValue('My unfinished rename'); expect(useFiltersStore.getState().leads).toEqual({ search: 'Keep' }); expect(writes).toEqual([])
})
it('keeps the current list when a stage is missing and disables actions during pending search hydration', async () => {
  rows = [{ ...row, filters: { stageId: id } } as any]; useFiltersStore.setState({ leads: { search: 'Keep' } }); const ui = render(<SavedLeadViews {...props} filtersReady={false} />); await choose(); expect(screen.getByRole('button', { name: 'Apply view' })).toBeDisabled()
  ui.rerender(<SavedLeadViews {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Apply view' })); expect(await screen.findByRole('alert')).toHaveTextContent('stage'); expect(useFiltersStore.getState().leads).toEqual({ search: 'Keep' }); expect(writes).toEqual([])
})
it('retries an uncertain create only on request with the same frozen identifier and values', async () => {
  rows = []; render(<SavedLeadViews {...props} />); await screen.findByText('No saved views yet.'); fireEvent.change(screen.getByLabelText('View name'), { target: { value: 'Offline attempt' } })
  fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => { writes.push({ method: 'POST', body: JSON.parse(init.body as string) }); throw new Error('offline') })
  fireEvent.click(screen.getByRole('button', { name: 'Save as new view' })); await screen.findByRole('button', { name: 'Retry save' }); expect(writes).toHaveLength(1); fireEvent.click(screen.getByRole('button', { name: 'Retry save' })); await waitFor(() => expect(writes).toHaveLength(2)); expect(writes[1].body).toEqual(writes[0].body)
})
it('ignores a late previous-scope response and refuses identity-mismatched data', async () => {
  let resolve!: (value: Response) => void; fetchMock.mockImplementationOnce(() => new Promise<Response>(r => { resolve = r })); const ui = render(<SavedLeadViews {...props} />); ui.rerender(<SavedLeadViews {...props} organizationId="other" />)
  await act(async () => { resolve(reply([row])) }); await waitFor(() => expect(screen.queryByRole('option', { name: 'New prospects' })).not.toBeInTheDocument()); expect(await screen.findByRole('alert')).toHaveTextContent('Reload'); expect(writes).toEqual([])
})

it('keeps keyboard actions enabled during a background focus refresh', async () => {
  render(<SavedLeadViews {...props} />); await choose()
  let finish!: (value: Response) => void
  fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve }))
  fireEvent.focus(window)
  expect(screen.getByRole('button', { name: 'Apply view' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Apply view' }))
  expect(useFiltersStore.getState().leads).toEqual({ leadStatus: 'NEW' })
  await act(async () => { finish(reply(rows)) })
  expect(writes).toEqual([])
})

it('sends its expected account and clears private controls when that account changed before a write', async () => {
  render(<SavedLeadViews {...props} />); await choose()
  fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
    expect(init.headers).toMatchObject({ 'x-flowrish-view-user': 'user' })
    return new Response(JSON.stringify({ error: { code: 'SAVED_VIEW_CONTEXT_CHANGED', message: 'The account changed. Reload before continuing.' } }), { status: 409 })
  })
  fireEvent.change(screen.getByLabelText('View name'), { target: { value: 'Old account rename' } })
  fireEvent.click(screen.getByRole('button', { name: 'Rename view' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Reload')
  expect(screen.queryByRole('option', { name: 'New prospects' })).not.toBeInTheDocument()
  expect(screen.getByLabelText('View name')).toHaveValue('')
  expect(screen.getByRole('button', { name: 'Save as new view' })).toBeDisabled()
  expect(fetchMock).toHaveBeenCalledTimes(2); expect(writes).toEqual([])
})
