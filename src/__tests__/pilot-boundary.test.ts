import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ user: vi.fn() }))
vi.mock('@/lib/supabase/middleware', () => ({
  createSupabaseMiddleware: () => ({ auth: { getUser: mocks.user } }),
}))
import { middleware } from '@/middleware'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.user.mockResolvedValue({ data: { user: null } })
})
it('admits only the exact pilot page and non-authorizing session/status methods without a user lookup', async () => {
  for (const [path, method] of [
    ['/pilot', 'GET'],
    ['/pilot', 'HEAD'],
    ['/api/pilot/session', 'POST'],
    ['/api/pilot/session', 'DELETE'],
    ['/api/pilot/status', 'GET'],
  ]) {
    const response = await middleware(
      new NextRequest(`https://flowrish.example${path}`, { method }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('x-frame-options')).toBe('DENY')
  }
  expect(mocks.user).not.toHaveBeenCalled()
})
it('protects redemption, neighboring routes, and unsupported methods', async () => {
  for (const [path, method] of [
    ['/api/pilot/accept', 'POST'],
    ['/api/pilot/session', 'GET'],
    ['/api/pilot/status', 'POST'],
    ['/api/pilot/session/extra', 'POST'],
    ['/api/staff/waitlist/11111111-1111-4111-8111-111111111111/pilot', 'GET'],
  ]) {
    expect(
      (
        await middleware(
          new NextRequest(`https://flowrish.example${path}`, { method }),
        )
      ).status,
    ).toBe(401)
  }
  const page = await middleware(
    new NextRequest('https://flowrish.example/pilot/admin'),
  )
  expect(page.status).toBe(307)
})
