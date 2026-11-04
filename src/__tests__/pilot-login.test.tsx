import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ oauth: vi.fn(), otp: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowser: () => ({
    auth: { signInWithOAuth: mocks.oauth, signInWithOtp: mocks.otp },
  }),
}))
vi.mock('@/components/layout/auth-brand-panel', () => ({
  AuthBrandPanel: () => <aside>Flowrish</aside>,
}))
import Login from '@/app/(auth)/login/page'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.oauth.mockResolvedValue({ error: null })
  mocks.otp.mockResolvedValue({ error: null })
  history.replaceState(null, '', '/login?next=%2Fpilot')
})
afterEach(() => {
  cleanup()
  history.replaceState(null, '', '/')
})
it('keeps Google continuation local and credential-free using the mocked auth provider', async () => {
  render(<Login />)
  fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))
  await waitFor(() => expect(mocks.oauth).toHaveBeenCalledTimes(1))
  const url = new URL(mocks.oauth.mock.calls[0][0].options.redirectTo)
  expect(url.origin).toBe(window.location.origin)
  expect(url.pathname).toBe('/auth/callback')
  expect(url.search).toBe('')
  expect(url.hash).toBe('')
})
it('keeps magic-link continuation local using a mocked send only', async () => {
  render(<Login />)
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: 'prospect@example.test' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send magic link' }))
  await waitFor(() => expect(mocks.otp).toHaveBeenCalledTimes(1))
  const url = new URL(mocks.otp.mock.calls[0][0].options.emailRedirectTo)
  expect(url.origin).toBe(window.location.origin)
  expect(url.pathname).toBe('/auth/confirm')
  expect(url.search).toBe('')
  expect(url.hash).toBe('')
})
