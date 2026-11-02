import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReceptionistSettings } from './receptionist-settings'

const fixture = {
  config: null, businessName: 'Acme Bikes', currentUserId: '11111111-1111-4111-8111-111111111111',
  webhookPath: '/api/voice/receptionist/org-1',
  members: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Jane' }],
  stages: [{ id: '22222222-2222-4222-8222-222222222222', name: 'New', pipeline: { name: 'Sales' } }], calls: [],
}
beforeEach(() => { vi.restoreAllMocks() })

describe('ReceptionistSettings', () => {
  it('starts disabled, shows setup, and sends the edited configuration on save', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true, json: async () => fixture } as Response)
    fetchMock.mockImplementationOnce(async (_url, options) => ({ ok: true, json: async () => ({ config: JSON.parse(options?.body as string) }) } as Response))
    render(<ReceptionistSettings />)
    const enabled = await screen.findByLabelText('Enable AI receptionist')
    expect(enabled).not.toBeChecked()
    expect(screen.getByLabelText('Incoming call webhook URL')).toHaveValue('http://localhost:3000/api/voice/receptionist/org-1')
    fireEvent.change(screen.getByLabelText('Business information and FAQs'), { target: { value: 'Repairs start at 500 pesos.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save receptionist settings' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Receptionist settings saved.')
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toMatchObject({ enabled: false, knowledge: 'Repairs start at 500 pesos.', assigneeId: fixture.currentUserId })
  })

  it('shows a failed save without claiming the receptionist is enabled', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true, json: async () => fixture } as Response).mockResolvedValueOnce({ ok: false, json: async () => ({ error: { message: 'Connect Twilio first.' } }) } as Response)
    render(<ReceptionistSettings />)
    await screen.findByLabelText('Enable AI receptionist')
    fireEvent.change(screen.getByLabelText('When to answer'), { target: { value: 'always' } })
    fireEvent.click(screen.getByLabelText('Enable AI receptionist'))
    fireEvent.click(screen.getByRole('button', { name: 'Save receptionist settings' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Connect Twilio first.')
    expect(screen.getByText(/Saved setting: Off/)).toBeInTheDocument()
    expect(screen.queryByText('Receptionist settings saved.')).not.toBeInTheDocument()
  })

  it('allows retrying an initial load failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Connection unavailable')).mockResolvedValueOnce({ ok: true, json: async () => fixture } as Response)
    render(<ReceptionistSettings />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getByLabelText('Business name')).toHaveValue('Acme Bikes'))
  })

  it('allows saving the off setting when no pipeline stages are available', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ ...fixture, stages: [] }) } as Response)
    render(<ReceptionistSettings />)
    await screen.findByLabelText('Enable AI receptionist')
    expect(screen.getByRole('button', { name: 'Save receptionist settings' })).toBeEnabled()
  })
})
