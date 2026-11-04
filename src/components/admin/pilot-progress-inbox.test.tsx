import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { StaffWaitlistInbox } from './staff-waitlist-inbox'
import { sampleWaitlistEntry } from './waitlist-fixture.test-data'
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('clears prospect inbox when progress checking discovers revoked access', async () => {
  const fetch = vi.fn(async (url) =>
    String(url).endsWith('/progress')
      ? {
          ok: false,
          status: 403,
          json: async () => ({
            error: { message: 'Flowrish staff access is required.' },
          }),
        }
      : {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              entries: [sampleWaitlistEntry()],
              page: 1,
              hasNext: false,
              canHandoff: true,
            },
          }),
        },
  )
  vi.stubGlobal('fetch', fetch)
  render(<StaffWaitlistInbox />)
  const button = await screen.findByRole('button', {
    name: 'Check pilot setup progress for jamie@example.test',
  })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
  await waitFor(() =>
    expect(
      screen.queryByText('jamie@example.test', { exact: true }),
    ).not.toBeInTheDocument(),
  )
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Flowrish staff access is required.',
  )
  expect(fetch).toHaveBeenCalledTimes(2)
})
