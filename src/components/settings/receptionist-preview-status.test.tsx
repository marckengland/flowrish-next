import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initialCallState } from '@/lib/receptionist'
import { ReceptionistPreview } from './receptionist-preview'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('live AI preview feedback', () => {
 it.each([['ai', undefined, 'AI request completed for this turn.'], ['fallback', 'rate_limited', 'AI request limit reached.'], ['fallback', 'invalid_json', 'The AI response could not be read.'], ['fallback', 'timeout', 'The AI request timed out.']])('shows safe status for %s/%s', async (mode, reason, message) => {
  const result = { state: initialCallState(''), settingsVersion: 'version', reply: 'Hello from the test business.', finished: false, callback: null, sources: [] }
  const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ data: result }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ data: { ...result, generation: { mode, ...(reason ? { reason } : {}) } } }) })
  vi.stubGlobal('fetch', fetch)
  render(<ReceptionistPreview hasSavedSettings hasUnsavedChanges={false} />)
  fireEvent.click(screen.getByRole('button', { name: 'Start browser preview' }))
  await screen.findByRole('textbox', { name: 'Caller message' })
  fireEvent.change(screen.getByRole('textbox', { name: 'Caller message' }), { target: { value: 'How can you help?' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send caller message' }))
  await waitFor(() => expect(screen.getByText(message, { exact: false })).toBeInTheDocument())
  if (mode === 'fallback') expect(screen.getByText(/collecting a callback message instead/)).toBeInTheDocument()
 })
})
