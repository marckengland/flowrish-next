import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SavedFollowUpViews } from './saved-follow-up-views'
import type { SavedFollowUpView } from '@/lib/saved-follow-up-views'
const id = '11111111-1111-4111-8111-111111111111'
const row: SavedFollowUpView = { id, name: 'My callbacks', settings: { status: 'SNOOZED', filters: { search: 'Clinic', source: 'CALL', dueOnly: false } }, revision: 1, updatedAt: '2026-11-06T00:00:00.000Z' }
const scope = { organizationId: 'org', userId: 'user' }
const current = { status: 'PENDING' as const, filters: { search: 'Keep', source: 'ALL' as const, dueOnly: false } }
const apply = vi.fn(), lost = vi.fn(), request = vi.fn()
let rows: SavedFollowUpView[], writes: Array<{ method: string; body: Record<string, unknown> }>
const reply = (data: unknown) => new Response(JSON.stringify({ data, scope, capabilities: { canWrite: false } }))
const props = { context: scope, settings: current, disabled: false, onApply: apply, onAccessLost: lost }
beforeEach(() => {
  vi.resetAllMocks(); rows = [row]; writes = []; vi.stubGlobal('fetch', request)
  request.mockImplementation(async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'; if (method === 'GET') return reply(rows)
    const body = JSON.parse(init?.body as string); writes.push({ method, body })
    if (method === 'DELETE') return reply({ deleted: true })
    const { expectedRevision, ...changes } = body
    return reply({ ...row, ...changes, revision: method === 'POST' ? 1 : expectedRevision + 1 })
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
async function choose() { await screen.findByRole('option', { name: row.name }); fireEvent.change(screen.getByLabelText('Saved follow-up view'), { target: { value: id } }) }
it('loads without navigation and applies an explicit complete snapshot with scoped headers', async () => {
  render(<SavedFollowUpViews {...props} />); await choose(); expect(apply).not.toHaveBeenCalled(); expect(writes).toEqual([])
  fireEvent.click(screen.getByRole('button', { name: 'Apply view' })); expect(apply).toHaveBeenCalledWith(row.settings)
  expect(request.mock.calls[0][1]).toMatchObject({ cache: 'no-store', headers: expect.objectContaining({ 'x-flowrish-workspace': 'org', 'x-flowrish-follow-up-scope': JSON.stringify(['org', 'user']) }) })
})
it('creates, renames, replaces settings and explicitly confirms deletion without navigating', async () => {
  render(<SavedFollowUpViews {...props} />); await choose()
  fireEvent.change(screen.getByLabelText('View name'), { target: { value: 'Renamed' } }); fireEvent.click(screen.getByRole('button', { name: 'Rename view' })); await screen.findByText('Saved view updated.')
  expect(writes[0]).toEqual({ method: 'PATCH', body: { expectedRevision: 1, name: 'Renamed' } })
  fireEvent.click(screen.getByRole('button', { name: 'Replace saved settings' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Delete saved view' })).toBeEnabled()); expect(writes[1].body).toEqual({ expectedRevision: 2, settings: current })
  fireEvent.click(screen.getByRole('button', { name: 'Delete saved view' })); expect(writes).toHaveLength(2); fireEvent.click(screen.getByRole('button', { name: 'Confirm delete saved view' })); await screen.findByText('Saved view deleted. Your inbox filters and drafts were kept.')
  fireEvent.change(screen.getByLabelText('View name'), { target: { value: 'New view' } }); await waitFor(() => expect(screen.getByRole('button', { name: 'Save as new view' })).toBeEnabled()); fireEvent.click(screen.getByRole('button', { name: 'Save as new view' })); await screen.findByText('View saved.')
  expect(writes[3]).toMatchObject({ method: 'POST', body: { name: 'New view', settings: current } }); expect(apply).not.toHaveBeenCalled()
})
it('syncs metadata without replacing current settings or an unfinished rename and blocks stale revisions', async () => {
  render(<SavedFollowUpViews {...props} />); await choose(); fireEvent.change(screen.getByLabelText('View name'), { target: { value: 'Unfinished' } }); rows = [{ ...row, name: 'Other device', revision: 2 }]
  fireEvent.focus(window); await screen.findByRole('option', { name: 'Other device' }); expect(screen.getByLabelText('View name')).toHaveValue('Unfinished'); expect(apply).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Apply view' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Reload selected view' })); expect(screen.getByLabelText('View name')).toHaveValue('Other device'); expect(screen.getByRole('button', { name: 'Apply view' })).toBeEnabled(); expect(writes).toEqual([])
})
it('retries only an explicitly requested uncertain create with the frozen identifier and settings', async () => {
  rows = []; render(<SavedFollowUpViews {...props} />); await screen.findByText('No saved views yet.'); fireEvent.change(screen.getByLabelText('View name'), { target: { value: 'Offline' } })
  request.mockImplementationOnce(async (_url: string, init: RequestInit) => { writes.push({ method: 'POST', body: JSON.parse(init.body as string) }); throw new Error('offline') })
  fireEvent.click(screen.getByRole('button', { name: 'Save as new view' })); await screen.findByRole('button', { name: 'Retry save' }); expect(writes).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Retry save' })); await screen.findByText('View saved.'); expect(writes).toHaveLength(2); expect(writes[1].body).toEqual(writes[0].body); expect(apply).not.toHaveBeenCalled()
})
it('ignores late previous-workspace reads and denies identity-mismatched receipts', async () => {
  let finish!: (value: Response) => void; request.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve }))
  const ui = render(<SavedFollowUpViews {...props} />); ui.rerender(<SavedFollowUpViews {...props} context={{ ...scope, organizationId: 'other' }} />)
  await act(async () => { finish(reply([row])) }); await screen.findByRole('alert'); expect(screen.queryByRole('option', { name: row.name })).not.toBeInTheDocument(); expect(lost).toHaveBeenCalledTimes(1); expect(writes).toEqual([])
})
it('disables view actions during inbox operations without losing metadata or navigating', async () => {
  const ui = render(<SavedFollowUpViews {...props} />); await choose(); ui.rerender(<SavedFollowUpViews {...props} disabled />)
  expect(screen.getByRole('button', { name: 'Apply view' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Replace saved settings' })).toBeDisabled(); expect(screen.getByRole('option', { name: row.name })).toBeInTheDocument(); expect(writes).toEqual([])
})
it('normalizes rename values before sending and validates the canonical saved receipt', async () => {
  render(<SavedFollowUpViews {...props} />); await choose()
  request.mockImplementationOnce(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string); writes.push({ method: 'PATCH', body })
    return reply({ ...row, name: 'Morning callbacks', revision: 2 })
  })
  fireEvent.change(screen.getByLabelText('View name'), { target: { value: '  Morning   callbacks  ' } }); fireEvent.click(screen.getByRole('button', { name: 'Rename view' }))
  await screen.findByText('Saved view updated.'); expect(writes[0].body).toEqual({ expectedRevision: 1, name: 'Morning callbacks' }); expect(screen.getByLabelText('View name')).toHaveValue('Morning callbacks'); expect(screen.queryByRole('alert')).not.toBeInTheDocument(); expect(apply).not.toHaveBeenCalled()
})
