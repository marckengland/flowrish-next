import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WaitlistForm } from './waitlist-form'
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('submits the provided fixed attribution with mocked contact capture', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue({
      ok: true,
      json: async () => ({ data: { success: true } }),
    })
  vi.stubGlobal('fetch', fetch)
  render(<WaitlistForm source="public_demo" />)
  fireEvent.change(screen.getByLabelText(/email/i), {
    target: { value: 'jamie@example.test' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Join the waitlist' }))
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
    email: 'jamie@example.test',
    source: 'public_demo',
  })
})
