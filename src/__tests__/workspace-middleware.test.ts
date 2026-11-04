import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const auth = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/middleware', () => ({
  createSupabaseMiddleware: () => ({ auth: { getUser: auth } }),
}))
import { middleware } from '@/middleware'
beforeEach(() => {
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')
  auth.mockResolvedValue({ data: { user: { id: 'auth-one' } } })
})
it('overwrites spoofed method/path stamps with the actual request context', async () => {
  const response = await middleware(
    new NextRequest('https://flowrish.example.test/api/tasks', {
      method: 'POST',
      headers: {
        'x-flowrish-request-method': 'GET',
        'x-flowrish-request-path': '/fake',
      },
    }),
  )
  expect(
    response.headers.get('x-middleware-request-x-flowrish-request-method'),
  ).toBe('POST')
  expect(
    response.headers.get('x-middleware-request-x-flowrish-request-path'),
  ).toBe('/api/tasks')
})
it('denies stale API and Next action requests before an action can run', async () => {
  for (const path of ['/api/tasks', '/tasks']) {
    const response = await middleware(
      new NextRequest(`https://flowrish.example.test${path}`, {
        method: 'POST',
        headers: {
          cookie:
            'flowrish_workspace=auth-one%3A22222222-2222-4222-8222-222222222222',
          'x-flowrish-workspace': '11111111-1111-4111-8111-111111111111',
          'next-action': 'synthetic',
        },
      }),
    )
    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('WORKSPACE_CHANGED')
    expect(response.headers.get('cache-control')).toContain('no-store')
  }
})
it('forwards refreshed auth cookies alongside the canonical workspace request context', async () => {
  const request = new NextRequest('https://flowrish.example.test/dashboard', {
    headers: { cookie: 'synthetic_auth=old' },
  })
  auth.mockImplementationOnce(async () => {
    request.cookies.set('synthetic_auth', 'refreshed')
    return { data: { user: { id: 'auth-one' } } }
  })
  const response = await middleware(request)
  expect(response.headers.get('x-middleware-request-cookie')).toContain(
    'synthetic_auth=refreshed',
  )
  expect(
    response.headers.get('x-middleware-request-x-flowrish-request-method'),
  ).toBe('GET')
  expect(
    response.headers.get('x-middleware-request-x-flowrish-request-path'),
  ).toBe('/dashboard')
})
