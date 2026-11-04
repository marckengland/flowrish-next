import { beforeEach, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
const m = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: m.session }))
vi.mock('@/server/auth/permissions', () => ({ requirePermission: m.permission }))
vi.mock('@/server/services/saved-lead-views', () => ({ listSavedLeadViews: m.list, createSavedLeadView: m.create, updateSavedLeadView: m.update, deleteSavedLeadView: m.remove }))
import { GET, POST } from './route'
import { PATCH, DELETE } from './[id]/route'
const id = '11111111-1111-4111-8111-111111111111', context = { params: Promise.resolve({ id }) }
function request(method: string, body: unknown, origin = 'https://app.example') { return new Request('https://app.example/api/lead-views', { method, headers: { origin, 'content-type': 'application/json', 'x-flowrish-view-user': 'session-user' }, body: typeof body === 'string' ? body : JSON.stringify(body) }) }
beforeEach(() => { vi.resetAllMocks(); m.session.mockResolvedValue({ organizationId: 'session-org', dbUser: { id: 'session-user' } }); m.list.mockResolvedValue([]) })
it('uses session identity for every operation and sends no-store identity-bound responses', async () => {
  const create = { id, name: 'Prospects', filters: {} }, update = { expectedRevision: 1, name: 'Renamed' }, remove = { expectedRevision: 2 }
  for (const response of [await GET(new Request('https://app.example/api/lead-views')), await POST(request('POST', create)), await PATCH(request('PATCH', update), context), await DELETE(request('DELETE', remove), context)]) {
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store'); expect((await response.json()).scope).toEqual({ organizationId: 'session-org', userId: 'session-user' })
  }
  expect(m.permission).toHaveBeenCalledWith({ id: 'session-user' }, 'leads:read'); expect(m.list).toHaveBeenCalledWith('session-org', 'session-user'); expect(m.create).toHaveBeenCalledWith('session-org', 'session-user', create); expect(m.update).toHaveBeenCalledWith('session-org', 'session-user', id, update); expect(m.remove).toHaveBeenCalledWith('session-org', 'session-user', id, remove)
})
it('rejects unauthenticated, unauthorized, foreign-origin and oversized/malformed requests before service calls', async () => {
  m.session.mockRejectedValueOnce(new AppError('UNAUTHORIZED', 'Sign in', 401)); expect((await GET(new Request('https://app.example/api/lead-views'))).status).toBe(401)
  m.permission.mockImplementationOnce(() => { throw new AppError('FORBIDDEN', 'No leads', 403) }); expect((await GET(new Request('https://app.example/api/lead-views'))).status).toBe(403)
  for (const origin of ['', 'null', 'https://other.example']) expect((await POST(request('POST', '{}', origin))).status).toBe(403)
  expect((await POST(request('POST', 'bad JSON'))).status).toBe(400); expect((await POST(request('POST', 'x'.repeat(9000)))).status).toBe(413)
  expect((await GET(new Request('https://app.example/api/lead-views?userId=other'))).status).toBe(400); expect((await PATCH(request('PATCH', '{}'), { params: Promise.resolve({ id: 'bad' }) })).status).toBe(400)
  expect(m.list).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled()
})
it('preserves conflict/not-found errors and hides database diagnostics without caching errors', async () => {
  m.remove.mockRejectedValue(new AppError('SAVED_VIEW_CONFLICT', 'Refresh', 409)); expect((await DELETE(request('DELETE', { expectedRevision: 1 }), context)).status).toBe(409)
  m.list.mockRejectedValue(new Error('private database password')); const response = await GET(new Request('https://app.example/api/lead-views')); expect(response.status).toBe(503); expect(response.headers.get('cache-control')).toBe('no-store'); expect(await response.text()).not.toContain('private database')
})

it('rejects missing or stale-account mutation fences before any service action', async () => {
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    for (const expected of [null, 'old-user']) {
      const req = request(method, method === 'POST' ? { id, name: 'Old account filters', filters: {} } : { expectedRevision: 1 })
      if (expected) req.headers.set('x-flowrish-view-user', expected); else req.headers.delete('x-flowrish-view-user')
      const response = method === 'POST' ? await POST(req) : method === 'PATCH' ? await PATCH(req, context) : await DELETE(req, context)
      expect(response.status).toBe(409); expect(response.headers.get('cache-control')).toBe('no-store')
      expect((await response.json()).error.code).toBe('SAVED_VIEW_CONTEXT_CHANGED')
    }
  }
  const staleRead = new Request('https://app.example/api/lead-views', { headers: { 'x-flowrish-view-user': 'old-user' } })
  expect((await GET(staleRead)).status).toBe(409)
  m.session.mockResolvedValue({ organizationId: 'session-org', dbUser: { id: 'new-account' } })
  expect((await POST(request('POST', { id, name: 'Old account filters', filters: {} }))).status).toBe(409)
  expect(m.create).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled(); expect(m.remove).not.toHaveBeenCalled(); expect(m.list).not.toHaveBeenCalled()
})
