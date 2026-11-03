import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebsiteReceptionistSettings } from '@/components/settings/website-receptionist-settings'

const stamp = '2026-11-03T00:00:00.000Z'
const callback = { id: '22222222-2222-4222-8222-222222222222', fullName: 'Sample Visitor', phone: '+639171234567', reason: 'Repair estimate', siteOrigin: 'https://shop.example', status: 'pending', consentedAt: stamp, createdAt: stamp, updatedAt: stamp }
const list = { callbacks: [callback], page: 1, pageSize: 20, hasMore: true }
const fetch = vi.fn(), response = (data: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => ({ data }) })
beforeEach(() => { fetch.mockReset(); vi.stubGlobal('fetch', fetch) })
afterEach(() => { vi.unstubAllGlobals() })
async function load() { fetch.mockResolvedValueOnce(response(list)); fireEvent.click(screen.getByRole('button', { name: 'Load callback requests' })); await screen.findByText('Sample Visitor') }

describe('shared receptionist callback-only inbox', () => {
  it('shows callback work without any configuration controls or automatic requests', async () => {
    render(<WebsiteReceptionistSettings callbacksOnly />)
    expect(screen.getByRole('region', { name: 'Receptionist callback inbox' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Load callback requests' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Load website receptionist settings' })).toBeNull()
    expect(screen.queryByText('Website receptionist', { exact: true })).toBeNull()
    expect(screen.queryByLabelText('Enable website receptionist')).toBeNull()
    expect(screen.queryByLabelText('Daily token allowance')).toBeNull()
    expect(screen.queryByLabelText('Website embed snippet')).toBeNull()
    expect(fetch).not.toHaveBeenCalled(); expect(document.querySelector('script, iframe')).toBeNull()
    await load(); expect(fetch.mock.calls[0][0]).toBe('/api/admin/website-receptionist/callbacks?status=pending&page=1'); expect(fetch.mock.calls[0][1].method).toBeUndefined()
  })
  it('keeps pending, reviewed, dismissed and all filters explicit and paginates the loaded view', async () => {
    render(<WebsiteReceptionistSettings callbacksOnly />); await load()
    fireEvent.change(screen.getByLabelText('Callback status'), { target: { value: 'reviewed' } }); expect(fetch).toHaveBeenCalledTimes(1)
    fetch.mockResolvedValueOnce(response({ ...list, page: 2 })); fireEvent.click(screen.getByRole('button', { name: 'Next callback page' })); await screen.findByText(/Showing pending · Page 2/)
    expect(fetch.mock.calls[1][0]).toContain('status=pending&page=2')
    for (const status of ['reviewed', 'dismissed', 'all']) {
      fireEvent.change(screen.getByLabelText('Callback status'), { target: { value: status } }); fetch.mockResolvedValueOnce(response({ ...list, callbacks: [], hasMore: false })); fireEvent.click(screen.getByRole('button', { name: 'Reload callback requests' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Reload callback requests' })).toBeEnabled())
      expect(fetch.mock.lastCall?.[0]).toContain(`status=${status}&page=1`); expect(screen.getByText('No callback requests in this view.')).toBeInTheDocument()
    }
    expect(fetch.mock.calls.every(call => !call[1]?.method)).toBe(true)
  })
  it('retains explicit permanent-delete confirmation and expected-version status changes', async () => {
    render(<WebsiteReceptionistSettings callbacksOnly />); await load()
    fireEvent.click(screen.getByRole('button', { name: 'Delete callback request' })); expect(fetch).toHaveBeenCalledTimes(1); fireEvent.click(screen.getByRole('button', { name: 'Cancel deletion' })); expect(fetch).toHaveBeenCalledTimes(1)
    fetch.mockResolvedValueOnce(response({ ...callback, status: 'reviewed' })).mockResolvedValueOnce(response({ ...list, callbacks: [], hasMore: false })); fireEvent.click(screen.getByRole('button', { name: 'Mark reviewed' })); await screen.findByText('Callback marked reviewed.')
    expect(fetch.mock.calls[1][0]).toBe(`/api/admin/website-receptionist/callbacks/${callback.id}`); expect(fetch.mock.calls[1][1].method).toBe('PATCH'); expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ action: 'review', expectedUpdatedAt: stamp })
  })
  it('opens an existing CRM handoff receipt and its available lead/task links without a write', async () => {
    render(<WebsiteReceptionistSettings callbacksOnly />); await load()
    const leadId = '33333333-3333-4333-8333-333333333333', taskId = '44444444-4444-4444-8444-444444444444'
    fetch.mockResolvedValueOnce(response({ callback, leads: [], contacts: [], members: [], stages: [], matchesTruncated: false, choicesTruncated: false, receipt: { callbackId: callback.id, leadId, taskId, createdAt: stamp, leadAvailable: true, taskAvailable: true } }))
    fireEvent.click(screen.getByRole('button', { name: 'Prepare CRM handoff' })); await screen.findByText('This callback has already been handed to CRM.')
    expect(screen.getByRole('link', { name: 'Open lead' })).toHaveAttribute('href', `/leads/${leadId}`); expect(screen.getByRole('link', { name: 'Open callback task' })).toHaveAttribute('href', `/tasks/${taskId}`)
    expect(screen.queryByRole('button', { name: 'Confirm CRM handoff' })).toBeNull(); expect(fetch.mock.calls.every(call => !call[1]?.method)).toBe(true)
  })
  it('clears unavailable lists on permission failures and never displays raw diagnostics', async () => {
    render(<WebsiteReceptionistSettings callbacksOnly />); await load(); fetch.mockResolvedValueOnce(response({ error: 'PRIVATE API KEY' }, 403)); fireEvent.click(screen.getByRole('button', { name: 'Reload callback requests' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load callback requests'); expect(screen.queryByText('Sample Visitor')).toBeNull(); expect(screen.queryByText('PRIVATE API KEY')).toBeNull()
  })
  it('aborts a pending list request and ignores its response after unmount', async () => {
    let resolve: (value: ReturnType<typeof response>) => void = () => {}; fetch.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const view = render(<WebsiteReceptionistSettings callbacksOnly />); fireEvent.click(screen.getByRole('button', { name: 'Load callback requests' })); const signal = fetch.mock.calls[0][1].signal; view.unmount(); expect(signal.aborted).toBe(true)
    render(<WebsiteReceptionistSettings callbacksOnly />); await act(async () => { resolve(response(list)) }); expect(screen.queryByText('Sample Visitor')).toBeNull(); expect(within(screen.getByRole('region', { name: 'Receptionist callback inbox' })).getByRole('button', { name: 'Load callback requests' })).toBeEnabled()
  })
})
