import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PilotInvitationPanel } from './pilot-invitation-panel'
import {
  pilotFixture,
  issuedPilotFixture,
  syntheticPilotLink,
} from './pilot-fixture.test-data'
import { waitlistIds } from './waitlist-fixture.test-data'
const fetchMock = vi.fn(),
  copy = vi.fn(),
  changed = vi.fn()
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('navigator', { clipboard: { writeText: copy } })
  fetchMock.mockReset().mockImplementation(async (url, init) => ({
    ok: true,
    status: 200,
    json: async () => ({
      data: String(url).endsWith('/preview')
        ? {
            version: 'a'.repeat(64),
            email: 'jamie@example.test',
            expiresInDays: 7,
          }
        : init?.method === 'POST'
          ? { ...issuedPilotFixture(), link: syntheticPilotLink }
          : pilotFixture(),
    }),
  }))
  copy.mockReset().mockResolvedValue(undefined)
  changed.mockReset()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
async function open() {
  render(
    <PilotInvitationPanel
      entryId={waitlistIds.entry}
      email="jamie@example.test"
      onEntryChanged={changed}
    />,
  )
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Manage pilot invitation for jamie@example.test',
    }),
  )
  const preview = await screen.findByRole('button', {
    name: 'Preview pilot invitation',
  })
  await waitFor(() => expect(preview).toBeEnabled())
  return preview
}
it('remains collapsed without reading or issuing invitations automatically', () => {
  render(
    <PilotInvitationPanel
      entryId={waitlistIds.entry}
      email="jamie@example.test"
      onEntryChanged={changed}
    />,
  )
  expect(fetchMock).not.toHaveBeenCalled()
  expect(copy).not.toHaveBeenCalled()
})
it('requires a fresh preview and approval, shows the private link once, and copies only on request', async () => {
  fireEvent.click(await open())
  const approval = await screen.findByRole('checkbox', {
    name: 'I approve pilot access for this signup.',
  })
  await waitFor(() => expect(approval).toBeEnabled())
  const issue = screen.getByRole('button', { name: 'Issue private pilot link' })
  expect(issue).toBeDisabled()
  fireEvent.click(approval)
  fireEvent.click(issue)
  const link = await screen.findByLabelText('Private pilot link')
  expect(link).toHaveValue(syntheticPilotLink)
  expect(changed).toHaveBeenCalledWith(
    expect.objectContaining({ status: 'invited' }),
  )
  expect(copy).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Copy private link' }))
  await waitFor(() => expect(copy).toHaveBeenCalledWith(syntheticPilotLink))
  fireEvent.click(
    screen.getByRole('button', { name: 'Close pilot invitation' }),
  )
  expect(screen.queryByLabelText('Private pilot link')).not.toBeInTheDocument()
})
it('does not recover plaintext or silently reissue after an uncertain issuance', async () => {
  const prior = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation(async (url, init) =>
    String(url).endsWith('/pilot') && init?.method === 'POST'
      ? {
          ok: true,
          status: 200,
          json: async () => ({ data: { ...issuedPilotFixture(), link: null } }),
        }
      : prior(url, init),
  )
  fireEvent.click(await open())
  const approval = await screen.findByRole('checkbox', {
    name: 'I approve pilot access for this signup.',
  })
  await waitFor(() => expect(approval).toBeEnabled())
  fireEvent.click(approval)
  fireEvent.click(
    screen.getByRole('button', { name: 'Issue private pilot link' }),
  )
  expect(
    await screen.findByText(/cannot recover the private link/),
  ).toBeVisible()
  expect(screen.queryByLabelText('Private pilot link')).not.toBeInTheDocument()
  expect(
    fetchMock.mock.calls.filter(
      ([, init]) => init?.method === 'POST' && JSON.parse(init.body).confirmed,
    ),
  ).toHaveLength(1)
})
