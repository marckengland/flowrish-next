import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initialCallState } from '@/lib/receptionist'
import { ReceptionistPreview } from './receptionist-preview'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('preview rehearsal snapshot capture', () => {
  it('saves only on explicit request and preserves sources for each reply across later turns', async () => {
    const version = '2026-11-02T00:00:00.000Z'
    const source = { id: '22222222-2222-4222-8222-222222222222', title: 'Approved pricing', revision: 3 }
    const result = { state: initialCallState(''), settingsVersion: version, reply: 'Hello', finished: false, callback: null, sources: [] }
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ data: result }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ data: { ...result, reply: 'A puncture repair costs 250 pesos.', sources: [source], generation: { mode: 'ai' } } }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ data: { ...result, reply: 'Please leave callback details.', generation: { mode: 'fallback', reason: 'timeout' } } }) }).mockImplementationOnce(async (_url, options) => {
      const payload = JSON.parse(options.body)
      return { ok: true, json: async () => ({ data: { id: '11111111-1111-4111-8111-111111111111', ...payload, createdAt: version, updatedAt: version, verdict: 'unreviewed', notes: '', unansweredMessageIndexes: [] } }) }
    })
    vi.stubGlobal('fetch', fetch)
    render(<ReceptionistPreview hasSavedSettings hasUnsavedChanges={false} />)
    expect(screen.getByRole('button', { name: 'Save rehearsal' })).toBeDisabled()
    expect(fetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Start browser preview' }))
    const caller = await screen.findByRole('textbox', { name: 'Caller message' })
    await waitFor(() => expect(caller).toBeEnabled())
    fireEvent.change(caller, { target: { value: 'How much is a repair?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send caller message' }))
    await screen.findByText('A puncture repair costs 250 pesos.')
    await waitFor(() => expect(caller).toBeEnabled())
    fireEvent.change(caller, { target: { value: 'What about an unlisted service?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send caller message' }))
    await screen.findByText('Please leave callback details.')
    expect(fetch).toHaveBeenCalledTimes(3)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save rehearsal' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Save rehearsal' }))
    await screen.findByText('Rehearsal saved.', { exact: true })
    expect(fetch.mock.calls[3][0]).toBe('/api/admin/receptionist/rehearsals')
    const saved = JSON.parse(fetch.mock.calls[3][1].body)
    expect(saved.snapshot.settingsVersion).toBe(version)
    expect(saved.snapshot.messages).toEqual([
      { role: 'receptionist', content: 'Hello', sources: [], generation: 'scripted' },
      { role: 'caller', content: 'How much is a repair?', sources: [], generation: 'scripted' },
      { role: 'receptionist', content: 'A puncture repair costs 250 pesos.', sources: [source], generation: 'ai' },
      { role: 'caller', content: 'What about an unlisted service?', sources: [], generation: 'scripted' },
      { role: 'receptionist', content: 'Please leave callback details.', sources: [], generation: 'fallback' },
    ])
    expect(saved.snapshot.clientId).toMatch(/^[0-9a-f-]{36}$/)
    fireEvent.click(screen.getByRole('button', { name: 'End preview' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save rehearsal' })).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Load saved rehearsals' })).toBeEnabled()
  })
})
