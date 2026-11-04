import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PilotOnboarding } from './pilot-onboarding'
const fetchMock = vi.fn()
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset().mockImplementation(async (url) => ({
    ok: true,
    status: 200,
    json: async () => ({
      data:
        String(url) === '/api/pilot/session'
          ? { received: true }
          : { state: 'ready', expiresAt: '2026-11-11T01:00:00.000Z' },
    }),
  }))
  history.replaceState(null, '', '/pilot')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  history.replaceState(null, '', '/')
})
it('removes a fragment before exchanging it, stores no bearer, and never creates from a page view', async () => {
  const token = 'b'.repeat(64)
  history.replaceState(null, '', `/pilot#invite=${token}`)
  const before = { local: { ...localStorage }, session: { ...sessionStorage } }
  render(<PilotOnboarding />)
  await screen.findByRole('textbox', { name: 'Business name' })
  expect(location.hash).toBe('')
  expect(fetchMock.mock.calls[0]).toMatchObject([
    '/api/pilot/session',
    { method: 'POST', body: JSON.stringify({ token }) },
  ])
  expect(
    fetchMock.mock.calls.some(([url]) => String(url).includes(token)),
  ).toBe(false)
  expect(
    fetchMock.mock.calls.some(([url]) => String(url).endsWith('/accept')),
  ).toBe(false)
  expect({
    local: { ...localStorage },
    session: { ...sessionStorage },
  }).toEqual(before)
})
it('requires confirmed business details and clears consent after edits', async () => {
  render(<PilotOnboarding />)
  const name = await screen.findByRole('textbox', { name: 'Business name' })
  fireEvent.change(name, { target: { value: 'Synthetic business' } })
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Workspace identifier' }),
    { target: { value: 'synthetic-business' } },
  )
  const submit = screen.getByRole('button', {
      name: 'Create my pilot workspace',
    }),
    consent = screen.getByRole('checkbox', {
      name: 'I confirm these details and want to create my own workspace.',
    })
  expect(submit).toBeDisabled()
  fireEvent.click(consent)
  fireEvent.change(name, { target: { value: 'Corrected business' } })
  expect(consent).not.toBeChecked()
  fireEvent.click(consent)
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({
      data: {
        state: 'joined',
        organizationName: 'Corrected business',
        continueHref: '/receptionist/setup',
      },
    }),
  })
  fireEvent.click(submit)
  expect(
    await screen.findByRole('link', { name: 'Continue receptionist setup' }),
  ).toHaveAttribute('href', '/receptionist/setup')
  const accept = fetchMock.mock.calls.find(([url]) =>
    String(url).endsWith('/accept'),
  )
  expect(JSON.parse(accept![1].body)).toEqual({
    name: 'Corrected business',
    slug: 'synthetic-business',
    confirmed: true,
  })
})
it('reveals no form or recipient information when the link is unavailable', async () => {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: { state: 'unavailable' } }),
  })
  render(<PilotOnboarding />)
  expect(await screen.findByText(/unavailable for this account/)).toBeVisible()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
})
it('shows sign-in guidance without invoking a provider or creating records', async () => {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: { state: 'sign_in' } }),
  })
  render(<PilotOnboarding />)
  expect(
    await screen.findByRole('link', { name: 'Sign in with the invited email' }),
  ).toHaveAttribute('href', '/login?next=/pilot')
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
})
