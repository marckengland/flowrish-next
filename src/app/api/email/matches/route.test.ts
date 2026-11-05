import { beforeEach, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
const m = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn(), list: vi.fn(), preview: vi.fn(), resolve: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: m.session }))
vi.mock('@/server/auth/permissions', () => ({ requirePermission: m.permission }))
vi.mock('@/server/services/email-match-review', () => ({ listEmailMatches: m.list, previewEmailMatch: m.preview, resolveEmailMatch: m.resolve }))
import { GET } from './route'
import { POST as preview } from './[id]/preview/route'
import { POST as resolve } from './[id]/resolve/route'
const id = '550e8400-e29b-41d4-a716-446655440001', ctx = { params: Promise.resolve({ id }) }
const request = (body: unknown = {}, user: string | null = 'user') => new Request('https://app.example/api/email/matches', { method: 'POST', headers: { origin: 'https://app.example', 'content-type': 'application/json', 'x-flowrish-workspace': 'org', ...(user ? { 'x-flowrish-mail-match-user': user } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) })
beforeEach(() => { vi.resetAllMocks(); m.session.mockResolvedValue({ organizationId: 'org', dbUser: { id: 'user' } }); m.list.mockResolvedValue([]) })
it('uses current owner scope and no-store responses for list, preview and resolution', async () => {
  for (const response of [await GET(request()), await preview(request(), ctx), await resolve(request({ confirmed: true }), ctx)]) { expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store'); expect((await response.json()).scope).toEqual({ organizationId: 'org', userId: 'user' }) }
  expect(m.list).toHaveBeenCalledWith('org', 'user'); expect(m.preview).toHaveBeenCalledWith('org', 'user', id); expect(m.resolve).toHaveBeenCalledWith('org', 'user', id, { confirmed: true }); expect(m.permission).toHaveBeenCalledWith({ id: 'user' }, 'leads:read'); expect(m.permission).toHaveBeenCalledWith({ id: 'user' }, 'leads:write')
})
it('rejects anonymous, stale identity, workspace, cross-origin and malformed bodies before routing', async () => {
  m.session.mockRejectedValueOnce(new AppError('UNAUTHORIZED', 'Sign in', 401)); expect((await GET(request())).status).toBe(401)
  for (const user of [null, 'stale']) expect((await resolve(request({}, user), ctx)).status).toBe(409)
  const stale = request(); stale.headers.set('x-flowrish-workspace', 'foreign'); expect((await preview(stale, ctx)).status).toBe(409)
  for (const origin of ['', 'null', 'https://foreign.example']) { const req = request(); req.headers.set('origin', origin); expect((await resolve(req, ctx)).status).toBe(403) }
  expect((await preview(request('bad'), ctx)).status).toBe(400); expect((await resolve(request('x'.repeat(9000)), ctx)).status).toBe(413); expect(m.resolve).not.toHaveBeenCalled(); expect(m.preview).not.toHaveBeenCalled()
})
it('retains authorization errors and hides internal errors without logging message content', async () => {
  m.permission.mockImplementationOnce(() => { throw new AppError('FORBIDDEN', 'No access', 403) }); expect((await GET(request())).status).toBe(403)
  m.resolve.mockRejectedValue(new Error('private provider content')); const response = await resolve(request(), ctx); expect(response.status).toBe(503); expect(response.headers.get('cache-control')).toBe('no-store'); expect(await response.text()).not.toContain('private provider')
})
