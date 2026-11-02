import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { WebsiteReceptionistSettings } from './website-receptionist-settings'

const version = '2026-11-03T00:00:00.000Z'
const publicId = '11111111-1111-4111-8111-111111111111'
const settings = { publicId, enabled: false, allowedOrigins: ['https://example.com'], dailyMessageLimit: 5, dailyTokenLimit: 20000, dailyCallbackLimit: 10, updatedAt: version }
const ready = { settings: null, hasSavedBusiness: true, approvedDocuments: 2, hasOrganizationAi: true, usage: { sessions: 0, messages: 0, reservedTokens: 0, callbacks: 0 } }
const callback = { id: '22222222-2222-4222-8222-222222222222', fullName: 'Ana Cruz', phone: '+639171234567', reason: 'Repair estimate', siteOrigin: 'https://example.com', status: 'pending', consentedAt: version, createdAt: version, updatedAt: version }
const listing = { callbacks: [callback], page: 1, pageSize: 20, hasMore: false }
function response(data: unknown, status = 200): Response { return { ok: status >= 200 && status < 300, status, json: async () => ({ data }) } as Response }
async function loadSettings() { fireEvent.click(screen.getByRole('button', { name: 'Load website receptionist settings' })); await screen.findByLabelText('Enable website receptionist') }
async function loadCallbacks() { fireEvent.click(screen.getByRole('button', { name: 'Load callback requests' })); await screen.findByText('Ana Cruz') }

beforeEach(() => { vi.restoreAllMocks() })

describe('WebsiteReceptionistSettings', () => {
  it('makes no request on mount and requires explicit loading, enabling, and spending consent', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(ready)).mockResolvedValueOnce(response({ ...ready, settings: { ...settings, enabled: true } }))
    render(<WebsiteReceptionistSettings />)
    expect(fetchMock).not.toHaveBeenCalled()
    await loadSettings()
    expect(screen.getByLabelText('Enable website receptionist')).not.toBeChecked()
    expect(screen.getByLabelText('Daily token allowance')).toHaveValue(20000)
    fireEvent.change(screen.getByLabelText('Allowed website origins'), { target: { value: 'https://EXAMPLE.com/' } })
    fireEvent.click(screen.getByLabelText('Enable website receptionist'))
    expect(screen.getByRole('button', { name: 'Save website receptionist settings' })).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/I understand that website replies use/))
    fireEvent.click(screen.getByRole('button', { name: 'Save website receptionist settings' }))
    expect(await screen.findByText('Website receptionist settings saved.')).toBeInTheDocument()
    expect(fetchMock.mock.calls[1][0]).toBe('/api/admin/website-receptionist')
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({ enabled: true, allowedOrigins: ['https://example.com'], dailyMessageLimit: 5, dailyTokenLimit: 20000, dailyCallbackLimit: 10, expectedUpdatedAt: null, acknowledged: true })
    expect(screen.getByLabelText('Website embed snippet')).toHaveValue(`<script src="http://localhost:3000/receptionist-widget.js" data-flowrish-receptionist="${publicId}" defer></script>`)
    expect(document.querySelector('script, iframe')).toBeNull()
  })

  it.each(['http://example.com', 'https://example.com/path', 'https://*.example.com', 'https://user:password@example.com'])('rejects unsafe origin %s before a write', async (origin) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(ready))
    render(<WebsiteReceptionistSettings />)
    await loadSettings()
    fireEvent.change(screen.getByLabelText('Allowed website origins'), { target: { value: origin } })
    fireEvent.click(screen.getByRole('button', { name: 'Save website receptionist settings' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/exact HTTPS/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shows readiness and cannot enable without saved organization prerequisites', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ ...ready, hasSavedBusiness: false, hasOrganizationAi: false, approvedDocuments: 0 }))
    render(<WebsiteReceptionistSettings />)
    await loadSettings()
    expect(screen.getByLabelText('Enable website receptionist')).toBeDisabled()
    expect(screen.getByText('Saved business: Required')).toBeInTheDocument()
    expect(screen.getByText('Organization AI: Required')).toBeInTheDocument()
    expect(screen.getByText('Approved Library documents: 0')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save website receptionist settings' })).toBeEnabled()
  })

  it('preserves edits on conflict and requires confirmation before reloading them', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response({ ...ready, settings })).mockResolvedValueOnce(response({ error: 'private SQL error' }, 409)).mockResolvedValueOnce(response({ ...ready, settings }))
    render(<WebsiteReceptionistSettings />)
    await loadSettings()
    fireEvent.change(screen.getByLabelText('Daily message limit'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save website receptionist settings' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/changed.*Reload/i)
    expect(screen.getByLabelText('Daily message limit')).toHaveValue(7)
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string).expectedUpdatedAt).toBe(version)
    fireEvent.click(screen.getByRole('button', { name: 'Reload website receptionist settings' }))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByLabelText('Daily message limit')).toHaveValue(7)
    fireEvent.click(screen.getByRole('button', { name: 'Reload website receptionist settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard edits and reload' }))
    await waitFor(() => expect(screen.getByLabelText('Daily message limit')).toHaveValue(5))
  })

  it('rejects malformed settings DTOs and hides raw backend errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response({ ...ready, settings: { ...settings, providerKey: 'private' } })).mockRejectedValueOnce(new Error('private provider key'))
    render(<WebsiteReceptionistSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'Load website receptionist settings' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load website receptionist settings.')
    expect(screen.queryByLabelText('Website embed snippet')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load website receptionist settings' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load website receptionist settings' })).toBeEnabled())
    expect(document.body.textContent).not.toContain('private')
  })

  it('protects unsaved edits when navigating to another settings section', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(ready))
    render(<><a href="/settings?section=calling">Calling settings</a><WebsiteReceptionistSettings /></>)
    await loadSettings()
    fireEvent.change(screen.getByLabelText('Daily message limit'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('link', { name: 'Calling settings' }))
    expect(screen.getByText('Discard unsaved website receptionist edits before leaving?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByLabelText('Daily message limit')).toHaveValue(7)
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('guards the existing button-based Settings rail before unmounting dirty edits', async () => {
    const navigate = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(ready))
    render(<><nav aria-label="Settings sections"><button onClick={navigate}>Calling and voice</button></nav><WebsiteReceptionistSettings /></>)
    await loadSettings()
    fireEvent.change(screen.getByLabelText('Daily message limit'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Calling and voice' }))
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveFocus()
    expect(screen.getByText('Discard unsaved website receptionist edits before leaving?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByLabelText('Daily message limit')).toHaveValue(7)
    fireEvent.click(screen.getByRole('button', { name: 'Calling and voice' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard edits and leave' }))
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('aborts pending loads on unmount and prevents duplicate saves', async () => {
    let finish: (value: Response) => void = () => {}
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(ready)).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const view = render(<WebsiteReceptionistSettings />)
    await loadSettings()
    const save = screen.getByRole('button', { name: 'Save website receptionist settings' })
    fireEvent.click(save)
    fireEvent.click(save)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const signal = fetchMock.mock.calls[1][1]?.signal
    view.unmount()
    expect(signal?.aborted).toBe(true)
    await act(async () => { finish(response({ ...ready, settings })) })
  })

  it('lists confirmed callback fields as text and marks reviewed with a version before refreshing the page', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(listing)).mockResolvedValueOnce(response({ ...callback, status: 'reviewed' })).mockResolvedValueOnce(response({ ...listing, callbacks: [] }))
    render(<WebsiteReceptionistSettings />)
    await loadCallbacks()
    expect(screen.getByText('+639171234567')).toBeInTheDocument()
    expect(screen.getByText('Repair estimate')).toBeInTheDocument()
    expect(screen.getByText('https://example.com')).toBeInTheDocument()
    expect(screen.getByText(/Consent confirmed:/)).toBeInTheDocument()
    expect(document.querySelector('a[href^="tel:"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }))
    expect(await screen.findByText('Callback marked reviewed.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Ana Cruz')).not.toBeInTheDocument())
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['/api/admin/website-receptionist/callbacks?status=pending&page=1', `/api/admin/website-receptionist/callbacks/${callback.id}`, '/api/admin/website-receptionist/callbacks?status=pending&page=1'])
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({ action: 'review', expectedUpdatedAt: version })
  })

  it('requires explicit deletion confirmation and refreshes an already deleted record', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(listing)).mockResolvedValueOnce(response({}, 404)).mockResolvedValueOnce(response({ ...listing, callbacks: [] }))
    render(<WebsiteReceptionistSettings />)
    await loadCallbacks()
    fireEvent.click(screen.getByRole('button', { name: 'Delete callback request' }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel deletion' }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Delete callback request' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm deletion' }))
    expect(await screen.findByText('Callback request deleted.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Ana Cruz')).not.toBeInTheDocument())
    expect(fetchMock.mock.calls[1][1]?.method).toBe('DELETE')
  })

  it('preserves configuration edits across callback conflicts and allows explicit callback reload', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(ready)).mockResolvedValueOnce(response(listing)).mockResolvedValueOnce(response({}, 409)).mockResolvedValueOnce(response(listing))
    render(<WebsiteReceptionistSettings />)
    await loadSettings()
    fireEvent.change(screen.getByLabelText('Daily message limit'), { target: { value: '7' } })
    await loadCallbacks()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss callback' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/changed.*Reload/i)
    expect(screen.getByLabelText('Daily message limit')).toHaveValue(7)
    fireEvent.click(screen.getByRole('button', { name: 'Reload callback requests' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    expect(screen.getByLabelText('Daily message limit')).toHaveValue(7)
  })

  it('clears stale list and pagination when a confirmed write cannot refresh', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response({ ...listing, hasMore: true })).mockResolvedValueOnce(response({ ...callback, status: 'dismissed' })).mockRejectedValueOnce(new Error('private database error'))
    render(<WebsiteReceptionistSettings />)
    await loadCallbacks()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss callback' }))
    expect(await screen.findByText('Callback dismissed.')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('The change was saved, but callback requests could not be refreshed. Reload callback requests.')
    expect(screen.queryByText('Ana Cruz')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next callback page' })).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('private database')
  })

  it('rejects unsafe callback DTOs, retries safely, and renders visitor input only as text', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response({ ...listing, callbacks: [{ ...callback, siteOrigin: 'javascript:alert(1)' }] })).mockResolvedValueOnce(response({ ...listing, callbacks: [{ ...callback, fullName: '<img src=x onerror=alert(1)>' }] }))
    render(<WebsiteReceptionistSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'Load callback requests' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load callback requests.')
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Load callback requests' }))
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })

  it('returns to the previous page if the last record on a later page is reviewed', async () => {
    const later = { ...callback, fullName: 'Ben Cruz' }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response({ ...listing, hasMore: true }))
      .mockResolvedValueOnce(response({ ...listing, page: 2, callbacks: [later] }))
      .mockResolvedValueOnce(response({ ...later, status: 'reviewed' }))
      .mockResolvedValueOnce(response({ ...listing, page: 2, callbacks: [] }))
      .mockResolvedValueOnce(response(listing))
    render(<WebsiteReceptionistSettings />)
    await loadCallbacks()
    fireEvent.click(screen.getByRole('button', { name: 'Next callback page' }))
    await screen.findByText('Ben Cruz')
    fireEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }))
    await screen.findByText('Ana Cruz')
    expect(screen.queryByText('Ben Cruz')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous callback page' })).toBeDisabled()
    expect(fetchMock.mock.calls[3][0]).toBe('/api/admin/website-receptionist/callbacks?status=pending&page=2')
    expect(fetchMock.mock.calls[4][0]).toBe('/api/admin/website-receptionist/callbacks?status=pending&page=1')
  })

  it('aborts a callback load on unmount and ignores its stale completion', async () => {
    let finish: (value: Response) => void = () => {}
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const view = render(<WebsiteReceptionistSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'Load callback requests' }))
    view.unmount()
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true)
    await act(async () => { finish(response(listing)) })
    expect(screen.queryByText('Ana Cruz')).not.toBeInTheDocument()
  })

  it('filters and paginates callback requests without loading any website settings', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response({ ...listing, hasMore: true })).mockResolvedValueOnce(response({ ...listing, page: 2, callbacks: [{ ...callback, fullName: 'Ben Cruz' }] }))
    render(<WebsiteReceptionistSettings />)
    fireEvent.change(screen.getByLabelText('Callback status'), { target: { value: 'all' } })
    await loadCallbacks()
    fireEvent.click(screen.getByRole('button', { name: 'Next callback page' }))
    expect(await screen.findByText('Ben Cruz')).toBeInTheDocument()
    expect(screen.queryByText('Ana Cruz')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls[1][0]).toBe('/api/admin/website-receptionist/callbacks?status=all&page=2')
  })
})
