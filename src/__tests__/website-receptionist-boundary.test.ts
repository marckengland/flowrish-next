import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ user: vi.fn() }))
vi.mock('@/lib/supabase/middleware', () => ({ createSupabaseMiddleware: () => ({ auth: { getUser: mocks.user } }) }))
import { middleware } from '@/middleware'
const id = '11111111-1111-4111-8111-111111111111'
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ data: { user: null } }) })
describe('public website receptionist boundary', () => {
  it('admits only exact public methods without loading an application user', async () => {
    for (const [action, method] of [['embed', 'GET'], ['embed', 'HEAD'], ['session', 'POST'], ['message', 'POST'], ['callback', 'POST']]) {
      const response = await middleware(new NextRequest(`https://flowrish.example/api/public/website-receptionist/${id}/${action}`, { method }))
      expect(response.status).toBe(200)
    }
    expect(mocks.user).not.toHaveBeenCalled()
  })
  it('keeps app framing denied except the exact iframe HTML route', async () => {
    const frame = await middleware(new NextRequest(`https://flowrish.example/api/public/website-receptionist/${id}/embed`))
    expect(frame.headers.get('x-frame-options')).toBeNull()
    const api = await middleware(new NextRequest(`https://flowrish.example/api/public/website-receptionist/${id}/session`, { method: 'POST' }))
    expect(api.headers.get('x-frame-options')).toBe('DENY')
    const app = await middleware(new NextRequest('https://flowrish.example/settings'))
    expect(app.status).toBe(307)
    expect(app.headers.get('location')).toContain('/login')
  })
  it('does not make neighboring API paths or unsupported methods public', async () => {
    for (const [path, method] of [[`${id}/message`, 'GET'], [`${id}/embed`, 'POST'], [`${id}/admin`, 'GET'], [`${id}/callback/extra`, 'POST'], ['not-a-public-id/session', 'POST']]) {
      const response = await middleware(new NextRequest(`https://flowrish.example/api/public/website-receptionist/${path}`, { method }))
      expect(response.status).toBe(401)
    }
  })
})
