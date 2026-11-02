import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReceptionistSettings } from './receptionist-settings'

const config = {
  enabled: false, businessName: 'Acme Bikes', knowledge: '', mode: 'always',
  timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5],
  forwardTo: '', assigneeId: 'member-1', stageId: 'stage-1',
}
const settings = {
  config, businessName: 'Acme Bikes', currentUserId: 'member-1', webhookPath: '/api/voice/receptionist/org-1',
  members: [{ id: 'member-1', name: 'Jane' }],
  stages: [{ id: 'stage-1', name: 'New', pipeline: { name: 'Sales' } }], calls: [],
}
const state = {
  fullName: '', phone: '', reason: '', messages: [], turns: 0, awaitingConfirmation: false, silence: 0, fallbackField: null,
}
const ready = { saved: true, settingsVersion: 'version-1', approvedDocuments: 0, hasManualKnowledge: false, voiceConfigured: false, hasAuthToken: false }
const preview = { state, settingsVersion: 'version-1', reply: 'Thank you for calling Acme Bikes. How can I help?', finished: false, callback: null, sources: [] }
function response(data: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response
}
function mockApi(turns: Array<Response | Promise<Response>> = []) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
    if (url === '/api/admin/receptionist/readiness') return response({ data: ready })
    if (url === '/api/admin/receptionist/preview') return turns.shift() ?? response({ data: preview })
    if (options?.method === 'PUT') return response({ config: JSON.parse(options.body as string) })
    return response(settings)
  })
}

beforeEach(() => { vi.restoreAllMocks() })
afterEach(() => { vi.unstubAllGlobals() })

describe('receptionist onboarding and browser preview', () => {
  it('shows business-specific greeting edits and blocks preview until they are saved', async () => {
    const fetchMock = mockApi()
    render(<ReceptionistSettings />)
    await screen.findByLabelText('Business name')
    expect(screen.getByRole('list', { name: 'Receptionist setup steps' })).toHaveTextContent('Optional phone connection')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByLabelText('Business name'), { target: { value: 'Harbor Dental' } })
    expect(screen.getByLabelText('Greeting preview')).toHaveTextContent('Harbor Dental')
    expect(screen.getByRole('button', { name: 'Start browser preview' })).toBeDisabled()
    expect(screen.getByText(/Save your changes before testing/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save receptionist settings' }))
    await screen.findByText('Receptionist settings saved.')
    expect(screen.getByRole('button', { name: 'Start browser preview' })).toBeEnabled()
    expect(screen.getByLabelText('Enable AI receptionist')).not.toBeChecked()
  })

  it('checks saved knowledge lazily and explains missing knowledge without claiming phone verification', async () => {
    mockApi()
    render(<ReceptionistSettings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Check saved setup' }))
    expect(await screen.findByText(/0 approved public documents/)).toBeInTheDocument()
    expect(screen.getByText(/Missing answers will lead to callback collection/)).toBeInTheDocument()
    expect(screen.getByText(/Phone credentials are missing/)).toBeInTheDocument()
    expect(screen.getByText(/Phone routing has not been verified/)).toBeInTheDocument()
  })

  it('runs typed saved-setting turns and keypad confirmation with a preview-only callback summary', async () => {
    const confirming = { ...state, turns: 1, awaitingConfirmation: true, fullName: 'Test Caller', phone: '+639171234567', reason: 'Repair quote' }
    const fetchMock = mockApi([
      response({ data: preview }),
      response({ data: { ...preview, state: confirming, reply: 'Please confirm your callback details.', sources: [{ id: 'doc-1', title: 'Repair guide', revision: 2 }] } }),
      response({ data: { ...preview, state: { ...confirming, turns: 2 }, reply: 'Preview complete. No callback was saved.', finished: true, callback: { fullName: 'Test Caller', phone: '+639171234567', reason: 'Repair quote' } } }),
    ])
    render(<ReceptionistSettings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start browser preview' }))
    await screen.findByText(preview.reply)
    expect(screen.getByLabelText('Read replies aloud')).not.toBeChecked()
    fireEvent.change(screen.getByLabelText('Caller message'), { target: { value: 'I need a repair quote.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send caller message' }))
    await screen.findByText('Please confirm your callback details.')
    expect(screen.getByText(/Repair guide.*revision 2/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Press 1 to confirm' }))
    expect(await screen.findByText('Preview-only callback summary')).toBeInTheDocument()
    expect(screen.getByText('Test Caller')).toBeInTheDocument()
    expect(screen.getByText(/Nothing was saved to your CRM/)).toBeInTheDocument()
    const requests = fetchMock.mock.calls.filter(([url]) => url === '/api/admin/receptionist/preview').map(([, options]) => JSON.parse(options?.body as string))
    expect(requests).toEqual([{}, { state, settingsVersion: 'version-1', speech: 'I need a repair quote.' }, { state: confirming, settingsVersion: 'version-1', digits: '1' }])
  })

  it('clears an active conversation on edits and offers restart after stale saved settings', async () => {
    mockApi([response({ data: preview }), response({ error: { message: 'Settings changed. Restart preview.' } }, 409)])
    render(<ReceptionistSettings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start browser preview' }))
    await screen.findByText(preview.reply)
    fireEvent.change(screen.getByLabelText('Caller message'), { target: { value: 'Hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send caller message' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Settings changed. Restart preview.')
    expect(screen.getByRole('button', { name: 'Start browser preview' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Start browser preview' }))
    await screen.findByText(preview.reply)
    fireEvent.change(screen.getByLabelText('Business name'), { target: { value: 'New name' } })
    await waitFor(() => expect(screen.queryByText(preview.reply)).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Start browser preview' })).toBeDisabled()
  })

  it('keeps conversation controls usable without speech playback support', async () => {
    vi.stubGlobal('speechSynthesis', undefined)
    mockApi()
    render(<ReceptionistSettings />)
    await screen.findByRole('button', { name: 'Start browser preview' })
    expect(screen.getByText(/Read-aloud is unavailable in this browser/)).toBeInTheDocument()
    expect(screen.getByLabelText('Read replies aloud')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Start browser preview' }))
    await screen.findByText(preview.reply)
    expect(screen.getByLabelText('Caller message')).toBeEnabled()
  })

  it.each(['end', 'unmount'] as const)('ignores a late preview reply after %s even when the network ignores abort', async (stop) => {
    const speak = vi.fn()
    vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn() })
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} })
    let resolveLate!: (value: Response) => void
    const late = new Promise<Response>((resolve) => { resolveLate = resolve })
    const fetchMock = mockApi([response({ data: preview }), late])
    const view = render(<ReceptionistSettings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start browser preview' }))
    await screen.findByText(preview.reply)
    fireEvent.click(screen.getByLabelText('Read replies aloud'))
    fireEvent.change(screen.getByLabelText('Caller message'), { target: { value: 'Hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send caller message' }))
    await screen.findByRole('button', { name: 'Waiting for reply…' })
    const pendingSignal = fetchMock.mock.calls.filter(([url]) => url === '/api/admin/receptionist/preview')[1][1]?.signal
    if (stop === 'end') fireEvent.click(screen.getByRole('button', { name: 'End preview' }))
    else view.unmount()
    expect(pendingSignal?.aborted).toBe(true)
    await act(async () => { resolveLate(response({ data: { ...preview, reply: 'This reply arrived too late.' } })); await late })
    expect(screen.queryByText('This reply arrived too late.')).not.toBeInTheDocument()
    expect(speak).not.toHaveBeenCalled()
    if (stop === 'end') expect(screen.getByRole('button', { name: 'Start browser preview' })).toBeEnabled()
  })

  it('keeps typed conversation usable when speech playback throws', async () => {
    vi.stubGlobal('speechSynthesis', { speak: vi.fn(() => { throw new Error('Playback unavailable') }), cancel: vi.fn() })
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} })
    mockApi()
    render(<ReceptionistSettings />)
    fireEvent.click(await screen.findByLabelText('Read replies aloud'))
    fireEvent.click(screen.getByRole('button', { name: 'Start browser preview' }))
    await screen.findByText(preview.reply)
    expect(screen.getByText(/Read-aloud could not play/)).toBeInTheDocument()
    expect(screen.getByLabelText('Caller message')).toBeEnabled()
    fireEvent.change(screen.getByLabelText('Caller message'), { target: { value: 'Hello again' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send caller message' }))
    await waitFor(() => expect(screen.getByRole('log', { name: 'Preview conversation' })).toHaveTextContent('Hello again'))
    expect(screen.getByLabelText('Caller message')).toBeEnabled()
  })

  it.each([
    ['synthesis-failed', true],
    ['canceled', false],
    ['interrupted', false],
  ] as const)('handles the browser %s speech error without disrupting text conversation', async (error, showError) => {
    const speak = vi.fn()
    vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn() })
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} })
    mockApi()
    render(<ReceptionistSettings />)
    fireEvent.click(await screen.findByLabelText('Read replies aloud'))
    fireEvent.click(screen.getByRole('button', { name: 'Start browser preview' }))
    await screen.findByText(preview.reply)
    const utterance = speak.mock.calls[0][0] as SpeechSynthesisUtterance
    act(() => { utterance.onerror?.call(utterance, { error } as SpeechSynthesisErrorEvent) })
    expect(Boolean(screen.queryByText(/Read-aloud could not play/))).toBe(showError)
    expect(screen.getByLabelText('Caller message')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'End preview' })).toBeEnabled()
  })

  it('keeps read-aloud off initially and cancels it on reset and unmount', async () => {
    const speak = vi.fn()
    const cancel = vi.fn()
    vi.stubGlobal('speechSynthesis', { speak, cancel })
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} })
    mockApi()
    const view = render(<ReceptionistSettings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start browser preview' }))
    await screen.findByText(preview.reply)
    expect(speak).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('Read replies aloud'))
    fireEvent.change(screen.getByLabelText('Caller message'), { target: { value: 'Hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send caller message' }))
    await waitFor(() => expect(speak).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'End preview' }))
    expect(cancel).toHaveBeenCalled()
    expect(screen.queryByLabelText('Caller message')).not.toBeInTheDocument()
    cancel.mockClear()
    view.unmount()
    expect(cancel).toHaveBeenCalledTimes(1)
  })
})
