import {
  cleanup,
  render,
  screen,
  fireEvent,
  within,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), waitlist: true }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServer: mocks.auth }))
vi.mock('@/lib/waitlist', () => ({ isWaitlistEnabled: () => mocks.waitlist }))
vi.mock('./waitlist-form', () => ({
  WaitlistForm: () => <div>Waitlist form</div>,
}))
import PublicDemoPage, { metadata } from '@/app/(marketing)/demo/page'
import LandingPage from '@/app/(marketing)/page'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it('offers a public demo from the homepage in either signup mode', async () => {
  mocks.auth.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: null } }) },
  })
  for (const waitlist of [false, true]) {
    mocks.waitlist = waitlist
    render(await LandingPage())
    expect(
      screen.getByRole('link', { name: 'Try the receptionist demo' }),
    ).toHaveAttribute('href', '/demo')
    cleanup()
  }
})

it('renders an anonymous sample with local replies and the real waitlist contact path', () => {
  const fetch = vi.fn(() => {
    throw new Error('Public demo must not fetch')
  })
  vi.stubGlobal('fetch', fetch)
  render(<PublicDemoPage />)
  expect(
    screen.getByRole('heading', { level: 1, name: 'Try the receptionist' }),
  ).toBeVisible()
  expect(screen.getByText(/fixed sample details for Flowrish/)).toBeVisible()
  expect(
    screen.getByRole('link', { name: 'Back to Flowrish' }),
  ).toHaveAttribute('href', '/')
  expect(
    screen.getByRole('link', { name: 'Join the waitlist' }),
  ).toHaveAttribute('href', '/#waitlist')
  expect(
    screen.queryByRole('link', { name: 'Receptionist home' }),
  ).not.toBeInTheDocument()
  const log = screen.getByRole('log', { name: 'Demo conversation' })
  for (const [button, reply] of [
    ['Ask about services', 'Sample services excerpt'],
    ['Ask about pricing', 'Our team will confirm pricing'],
    ['Ask about hours', 'Asia/Manila'],
  ]) {
    fireEvent.click(screen.getByRole('button', { name: button }))
    expect(within(log).getByText(new RegExp(reply))).toBeVisible()
  }
  expect(log).not.toHaveTextContent('Approved')
  expect(metadata.alternates?.canonical).toBe('/demo')
  expect(mocks.auth).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})
