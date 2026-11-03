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

it('serves only the exact read-only public demo without an auth lookup', async () => {
  for (const method of ['GET', 'HEAD']) {
    const response = await middleware(
      new NextRequest('https://flowrish.example/demo', { method }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  }
  expect(mocks.user).not.toHaveBeenCalled()
})

it('keeps organization demos, neighboring routes, and mutations protected', async () => {
  for (const [path, method] of [
    ['/receptionist/demo', 'GET'],
    ['/demo/admin', 'GET'],
    ['/demo-other', 'GET'],
    ['/demo', 'POST'],
    ['/demo', 'PUT'],
    ['/demo', 'DELETE'],
  ]) {
    const response = await middleware(
      new NextRequest(`https://flowrish.example${path}`, { method }),
    )
    expect(response.status).toBe(307)
    expect(new URL(response.headers.get('location')!).pathname).toBe('/login')
  }
  const api = await middleware(
    new NextRequest('https://flowrish.example/api/demo', { method: 'POST' }),
  )
  expect(api.status).toBe(401)
})
