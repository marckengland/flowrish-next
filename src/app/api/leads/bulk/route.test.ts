import { beforeEach, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
const m = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn(), options: vi.fn(), preview: vi.fn(), apply: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: m.session }))
vi.mock('@/server/auth/permissions', () => ({ requirePermission: m.permission }))
vi.mock('@/server/services/bulk-lead-updates', () => ({ bulkLeadOptions: m.options, previewBulkLeadUpdate: m.preview, applyBulkLeadUpdate: m.apply }))
import { GET } from './route'
import { POST as preview } from './preview/route'
import { POST as apply } from './apply/route'
function request(body?: unknown) { return new Request('https://app.example/api/leads/bulk', { method: body === undefined ? 'GET' : 'POST', headers: { origin: 'https://app.example', 'content-type': 'application/json', 'x-flowrish-bulk-user': 'user' }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }) }
beforeEach(() => { vi.resetAllMocks(); m.session.mockResolvedValue({ organizationId: 'org', dbUser: { id: 'user' } }) })
it('derives identity from session and checks read and write permissions for all routes', async () => {
  for (const response of [await GET(request()), await preview(request({ selection: 'fixture' })), await apply(request({ id: 'receipt', confirmed: true }))]) {
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store'); expect((await response.json()).scope).toEqual({ organizationId: 'org', userId: 'user' })
  }
  expect(m.permission).toHaveBeenCalledWith({ id: 'user' }, 'leads:read'); expect(m.permission).toHaveBeenCalledWith({ id: 'user' }, 'leads:write')
  expect(m.options).toHaveBeenCalledWith('org', 'user'); expect(m.preview).toHaveBeenCalledWith('org', 'user', { selection: 'fixture' }); expect(m.apply).toHaveBeenCalledWith('org', 'user', { id: 'receipt', confirmed: true })
})
it('rejects anonymous, forbidden, missing/stale identity, foreign origin, invalid and oversized JSON before service actions', async () => {
  m.session.mockRejectedValueOnce(new AppError('UNAUTHORIZED', 'Sign in', 401)); expect((await GET(request())).status).toBe(401)
  m.permission.mockImplementationOnce(() => { throw new AppError('FORBIDDEN', 'No write', 403) }); expect((await GET(request())).status).toBe(403)
  for (const operation of [GET, preview, apply]) for (const user of [null, 'other']) { const req = request({}); if (user) req.headers.set('x-flowrish-bulk-user', user); else req.headers.delete('x-flowrish-bulk-user'); expect((await operation(req)).status).toBe(409) }
  for (const origin of ['', 'null', 'https://foreign.example']) { const req = request({}); req.headers.set('origin', origin); expect((await preview(req)).status).toBe(403) }
  expect((await apply(request('invalid'))).status).toBe(400); expect((await preview(request('x'.repeat(33000)))).status).toBe(413)
  const query = request(); expect((await GET(new Request(query.url + '?user=other', query))).status).toBe(400)
  expect(m.options).not.toHaveBeenCalled(); expect(m.preview).not.toHaveBeenCalled(); expect(m.apply).not.toHaveBeenCalled()
})
it('preserves conflicts and hides internal diagnostics with no-store errors', async () => {
  m.apply.mockRejectedValue(new AppError('BULK_LEADS_CHANGED', 'Fresh preview required', 409)); expect((await apply(request({}))).status).toBe(409)
  m.options.mockRejectedValue(new Error('database credentials')); const response = await GET(request()); expect(response.status).toBe(503); expect(response.headers.get('cache-control')).toBe('no-store'); expect(await response.text()).not.toContain('database credentials')
})
