import { beforeEach, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
const m = vi.hoisted(() => ({ session: vi.fn(), list: vi.fn(), count: vi.fn(), read: vi.fn(), focused: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: m.session }))
vi.mock('@/server/services/email-notifications', () => ({ listEmailNotifications: m.list, countEmailNotifications: m.count, readEmailNotification: m.read, focusedEmailFollowUp: m.focused }))
import { GET as list } from './route'
import { GET as count } from './count/route'
import { PATCH as read } from './[key]/route'
import { GET as focused } from './follow-up/[id]/route'
const key = 'a'.repeat(64), id = '11111111-1111-4111-8111-111111111111', context = { params: Promise.resolve({ key }) }
function request(body: unknown = { read: true }) { return new Request('https://app.example/api/email-notifications', { method: 'PATCH', headers: { origin: 'https://app.example', 'content-type': 'application/json', 'x-flowrish-workspace': 'org', 'x-flowrish-email-notification-user': 'owner' }, body: typeof body === 'string' ? body : JSON.stringify(body) }) }
beforeEach(() => { vi.resetAllMocks(); m.session.mockResolvedValue({ organizationId: 'org', dbUser: { id: 'owner' } }) })
it('uses only session identity with no-store and explicit response scope', async () => {
  for (const res of [await list(request()), await count(request()), await read(request(), context), await focused(request(), { params: Promise.resolve({ id }) })]) { expect(res.status).toBe(200); expect(res.headers.get('cache-control')).toBe('no-store'); expect((await res.json()).scope).toEqual({ organizationId: 'org', userId: 'owner' }) }
  expect(m.list).toHaveBeenCalledWith('org', 'owner', {}); expect(m.read).toHaveBeenCalledWith('org', 'owner', key); expect(m.focused).toHaveBeenCalledWith('org', 'owner', id)
})
it('rejects stale identity/workspace, anonymous, cross-origin, oversized and invalid writes before service calls', async () => {
  m.session.mockRejectedValueOnce(new AppError('UNAUTHORIZED', 'Sign in', 401)); expect((await list(request())).status).toBe(401)
  for (const header of ['x-flowrish-workspace', 'x-flowrish-email-notification-user']) { const req = request(); req.headers.delete(header); expect((await read(req, context)).status).toBe(409) }
  for (const origin of ['', 'null', 'https://foreign.example']) { const req = request(); req.headers.set('origin', origin); expect((await read(req, context)).status).toBe(403) }
  expect((await read(request('bad'), context)).status).toBe(400); expect((await read(request({ read: true, userId: 'other' }), context)).status).toBe(400); expect((await read(request('x'.repeat(9000)), context)).status).toBe(413); expect(m.read).not.toHaveBeenCalled()
})
it('rejects duplicate/oversized query values and hides internal diagnostics', async () => {
  const req = request(); expect((await list(new Request(req.url+'?page=1&page=2', req))).status).toBe(400); m.count.mockRejectedValue(new Error('private SQL and credentials')); const res = await count(request()); expect(res.status).toBe(503); expect(await res.text()).not.toContain('private SQL'); expect(res.headers.get('cache-control')).toBe('no-store')
})
