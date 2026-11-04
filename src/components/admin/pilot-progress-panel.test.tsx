import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PilotProgressPanel } from './pilot-progress-panel'
const fetchMock = vi.fn(),
  denied = vi.fn()
const fixture = () => ({
  state: 'joined',
  checkedAt: '2026-11-04T02:00:00.000Z',
  businessSaved: true,
  knowledge: { services: true, pricing: false, faqs: false },
  aiConfigured: false,
  websiteSaved: false,
  widgetEnabled: false,
  rehearsal: 'not_saved',
  nextStep: 'knowledge',
})
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: fixture() }),
  })
  denied.mockReset()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
const mount = () =>
  render(
    <PilotProgressPanel
      entryId="11111111-1111-4111-8111-111111111111"
      email="sample@example.test"
      onAccessDenied={denied}
    />,
  )
async function open() {
  mount()
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Check pilot setup progress for sample@example.test',
    }),
  )
  await screen.findByRole('heading', { name: 'Pilot setup progress' })
}
it('loads only on request, reports missing milestones, and makes no mutation', async () => {
  mount()
  expect(fetchMock).not.toHaveBeenCalled()
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Check pilot setup progress for sample@example.test',
    }),
  )
  await screen.findByText(
    'Publish and approve services, pricing guidance, and FAQs in the Library.',
  )
  expect(screen.getByText('Widget off')).toBeInTheDocument()
  expect(screen.getByText('Not saved')).toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/staff/waitlist/11111111-1111-4111-8111-111111111111/pilot/progress',
    { cache: 'no-store' },
  )
  expect(
    screen.queryByRole('link', { name: /customer|workspace/i }),
  ).not.toBeInTheDocument()
})
it('clears previous results on refresh failure and allows an explicit retry', async () => {
  await open()
  await screen.findByText('Widget off')
  fetchMock.mockRejectedValueOnce(new Error('Synthetic failure'))
  fireEvent.click(
    screen.getByRole('button', { name: 'Refresh pilot progress' }),
  )
  await screen.findByRole('alert', { name: 'Pilot progress error' })
  expect(screen.queryByText('Widget off')).not.toBeInTheDocument()
  fireEvent.click(
    screen.getByRole('button', { name: 'Refresh pilot progress' }),
  )
  await screen.findByText('Widget off')
  expect(fetchMock).toHaveBeenCalledTimes(3)
})
it('clears sensitive state and parent inbox on revoked access without retrying', async () => {
  await open()
  await screen.findByText('Widget off')
  fetchMock.mockResolvedValueOnce({
    ok: false,
    status: 403,
    json: async () => ({
      error: { message: 'Flowrish staff access is required.' },
    }),
  })
  fireEvent.click(
    screen.getByRole('button', { name: 'Refresh pilot progress' }),
  )
  await waitFor(() => expect(denied).toHaveBeenCalledTimes(1))
  expect(screen.queryByText('Widget off')).not.toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledTimes(2)
})
it('distinguishes saved review from current or live verification', async () => {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      data: { ...fixture(), rehearsal: 'stale', nextStep: 'rehearsal' },
    }),
  })
  await open()
  await screen.findByText('Setup changed — repeat rehearsal')
  expect(
    screen.getByText(/does not verify live AI quality or connectivity/),
  ).toBeInTheDocument()
})
it.each(['active', 'expired', 'revoked', 'not_issued'])(
  'shows %s invitations without fabricated customer progress',
  async (invitation) => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          state: 'not_joined',
          invitation,
          checkedAt: '2026-11-04T02:00:00.000Z',
        },
      }),
    })
    await open()
    await screen.findByText(/No pilot workspace has been joined/)
    expect(screen.queryByText('Widget off')).not.toBeInTheDocument()
  },
)
