import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { StaffWaitlistLink } from './staff-waitlist-link'
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it.each([false, true])(
  'shows the staff navigation only when the server says allowed=%s',
  async (allowed) => {
    const fetch = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({ data: { allowed } }),
      })
    vi.stubGlobal('fetch', fetch)
    render(<StaffWaitlistLink />)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    if (allowed)
      expect(
        await screen.findByRole('link', { name: 'Flowrish waitlist inbox' }),
      ).toHaveAttribute('href', '/staff/waitlist')
    else expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(fetch.mock.calls[0][0]).toBe('/api/staff/waitlist/access')
  },
)
