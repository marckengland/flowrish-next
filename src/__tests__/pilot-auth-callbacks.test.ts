import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PILOT_COOKIE_NAME } from '@/lib/pilot-onboarding'
const mocks = vi.hoisted(() => ({
  exchange: vi.fn(),
  verify: vi.fn(),
  findUser: vi.fn(),
  createUser: vi.fn(),
  pending: vi.fn(),
  join: vi.fn(),
  pilotIntent: vi.fn(),
}))
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { exchangeCodeForSession: mocks.exchange },
  }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({ auth: { verifyOtp: mocks.verify } }),
}))
vi.mock('@/server/db/client', () => ({
  prisma: {
    user: { findUnique: mocks.findUser, create: mocks.createUser },
    organizationInvite: { findFirst: mocks.pending },
  },
}))
vi.mock('@/server/services/organizations', () => ({ acceptInvite: mocks.join }))
vi.mock('@/server/auth/pilot-intent', () => ({
  hasPilotInvitationForEmail: mocks.pilotIntent,
}))
import { GET as callback } from '@/app/auth/callback/route'
import { GET as confirm } from '@/app/auth/confirm/route'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.pilotIntent.mockResolvedValue(false)
  const user = {
    id: 'auth-prospect',
    email: 'prospect@example.test',
    email_confirmed_at: '2026-11-04T00:00:00Z',
    user_metadata: {},
  }
  mocks.exchange.mockResolvedValue({ data: { user }, error: null })
  mocks.verify.mockResolvedValue({ data: { user }, error: null })
  mocks.findUser.mockResolvedValue({
    id: 'prospect',
    organizationMemberships: [],
  })
  mocks.createUser.mockResolvedValue({
    id: 'prospect',
    organizationMemberships: [],
  })
  mocks.pending.mockResolvedValue({ id: 'internal-team-invite' })
  mocks.join.mockResolvedValue({})
})
it.each([false, true])(
  'keeps OAuth pilot context with a pending team invitation (cookie=%s)',
  async (cookie) => {
    const request = new NextRequest(
      `https://flowrish.example/auth/callback?code=synthetic${cookie ? '' : '&next=%2Fpilot'}`,
    )
    if (cookie) request.cookies.set(PILOT_COOKIE_NAME, 'a'.repeat(64))
    expect(
      new URL((await callback(request)).headers.get('location')!).pathname,
    ).toBe('/pilot')
    expect(mocks.pending).not.toHaveBeenCalled()
    expect(mocks.join).not.toHaveBeenCalled()
  },
)
it('preserves the pilot destination for a newly created magic-link account', async () => {
  mocks.findUser.mockResolvedValue(null)
  const request = new NextRequest(
    'https://flowrish.example/auth/confirm?token_hash=synthetic&type=magiclink&next=%2Fpilot',
  )
  expect(
    new URL((await confirm(request)).headers.get('location')!).pathname,
  ).toBe('/pilot')
  expect(mocks.createUser).toHaveBeenCalledTimes(1)
  expect(mocks.join).not.toHaveBeenCalled()
})
it.each([callback, confirm])(
  'rejects an external continuation after sign-in',
  async (handler) => {
    mocks.findUser.mockResolvedValue({
      id: 'prospect',
      organizationMemberships: [{ organizationId: 'existing' }],
    })
    const request = new NextRequest(
      'https://flowrish.example/auth/callback?code=synthetic&token_hash=synthetic&type=magiclink&next=https%3A%2F%2Funtrusted.example',
    )
    const url = new URL((await handler(request)).headers.get('location')!)
    expect(url.origin).toBe('https://flowrish.example')
    expect(url.pathname).toBe('/dashboard')
  },
)
it('retains ordinary team invitation acceptance outside pilot context', async () => {
  const response = await callback(
    new NextRequest('https://flowrish.example/auth/callback?code=synthetic'),
  )
  expect(mocks.join).toHaveBeenCalledWith('internal-team-invite', 'prospect')
  expect(new URL(response.headers.get('location')!).pathname).toBe('/dashboard')
})

it.each([callback, confirm])(
  'keeps cross-device pilot accounts out of pending team invitations',
  async (handler) => {
    mocks.pilotIntent.mockResolvedValue(true)
    const request = new NextRequest(
      'https://flowrish.example/auth/callback?code=synthetic&token_hash=synthetic&type=magiclink',
    )
    expect(
      new URL((await handler(request)).headers.get('location')!).pathname,
    ).toBe('/pilot')
    expect(mocks.pilotIntent).toHaveBeenCalledWith('prospect@example.test')
    expect(mocks.pending).not.toHaveBeenCalled()
    expect(mocks.join).not.toHaveBeenCalled()
  },
)
