import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReceptionistSettings } from './receptionist-settings'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('readiness checklist settings integration', () => {
  it('clears previous results after edits and saves and requires a new explicit check', async () => {
    const config = {
      enabled: false, businessName: 'Sample Bikes', knowledge: '', mode: 'always',
      timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5],
      forwardTo: '', assigneeId: 'member-1', stageId: 'stage-1',
    }
    let checks = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      let body: unknown
      if (url === '/api/admin/receptionist/checklist') {
        checks++
        body = { data: {
          scope: 'saved_setup', checkedAt: '2026-11-02T10:00:00.000Z', settingsVersion: 'saved-1',
          checks: ['business', 'hours', 'knowledge', 'callbacks', 'ai'].map((id) => ({ id, label: id, status: 'complete', detail: 'Saved.' })),
        } }
      } else if (url === '/api/admin/receptionist' && options?.method === 'PUT') {
        body = { config: JSON.parse(options.body as string) }
      } else if (url === '/api/admin/receptionist') {
        body = {
          config, businessName: 'Sample Bikes', currentUserId: 'member-1', webhookPath: '/api/voice/receptionist/mock-org',
          members: [{ id: 'member-1', name: 'Alex' }],
          stages: [{ id: 'stage-1', name: 'New', pipeline: { name: 'Sales' } }], calls: [],
        }
      } else throw new Error(`Unexpected request: ${url}`)
      return { ok: true, json: async () => body } as Response
    })
    render(<ReceptionistSettings />)

    const button = await screen.findByRole('button', { name: 'Check readiness' })
    expect(checks).toBe(0)
    fireEvent.click(button)
    expect(await screen.findByText('5 of 5 saved setup checks complete')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: 'Business name' }), { target: { value: 'Updated Bikes' } })
    expect(screen.queryByText('5 of 5 saved setup checks complete')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check readiness' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Save receptionist settings' }))
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Check readiness' })).toBeEnabled() })
    expect(screen.queryByText('5 of 5 saved setup checks complete')).not.toBeInTheDocument()
    expect(screen.getByText('Saved setup has not been checked.')).toBeInTheDocument()
    expect(checks).toBe(1)

    fireEvent.click(screen.getByRole('button', { name: 'Check readiness' }))
    expect(await screen.findByText('5 of 5 saved setup checks complete')).toBeInTheDocument()
    expect(checks).toBe(2)
  })
})
