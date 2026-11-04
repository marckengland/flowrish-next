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
it('clears the entire prospect inbox when a pilot request detects revoked staff access', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) =>
      String(url).endsWith('/pilot')
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
    ),
  )
  render(<StaffWaitlistInbox />)
  const manage = await screen.findByRole('button', {
    name: 'Manage pilot invitation for jamie@example.test',
  })
  await waitFor(() => expect(manage).toBeEnabled())
  fireEvent.click(manage)
  await waitFor(() =>
    expect(
      screen.queryByText('jamie@example.test', { exact: true }),
    ).not.toBeInTheDocument(),
  )
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Flowrish staff access is required.',
  )
})
