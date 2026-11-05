import { beforeEach, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
const m = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn(), preview: vi.fn(), approve: vi.fn(), receipt: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: m.session }))
vi.mock('@/server/auth/permissions', () => ({ requirePermission: m.permission }))
vi.mock('@/server/services/follow-up-approval', () => ({ previewFollowUpApproval: m.preview, approveFollowUp: m.approve, readFollowUpApproval: m.receipt }))
import { GET, POST } from './route'
const context = { params: Promise.resolve({ id: 'item' }) }, requestId = '11111111-1111-4111-8111-111111111111'
function request(method = 'GET', query = '', body?: unknown) { return new Request(`https://app.example/api/follow-ups/item/approval${query}`, { method, headers: { origin: 'https://app.example', 'content-type': 'application/json', 'x-flowrish-workspace': 'org', 'x-flowrish-follow-up-scope': JSON.stringify(['org', 'actor']) }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }) }
beforeEach(() => { vi.resetAllMocks(); m.session.mockResolvedValue({ organizationId: 'org', dbUser: { id: 'actor' } }) })
it('uses session scope, fresh write permission and no-store for preview, confirm and receipt reads', async () => {
 for (const res of [await GET(request(), context), await GET(request('GET', `?requestId=${requestId}`), context), await POST(request('POST', '', { requestId }), context)]) { expect(res.status).toBe(200); expect(res.headers.get('cache-control')).toContain('no-store'); expect((await res.json()).scope).toEqual({ organizationId: 'org', userId: 'actor' }) }
 expect(m.preview).toHaveBeenCalledWith('org', 'actor', 'item'); expect(m.receipt).toHaveBeenCalledWith('org', 'actor', 'item', requestId); expect(m.approve).toHaveBeenCalledWith('org', 'actor', 'item', { requestId }); expect(m.permission).toHaveBeenCalledWith({ id: 'actor' }, 'leads:write')
})
it('rejects anonymous, read-only, stale account/workspace, foreign origin, malformed and oversized requests', async () => {
 m.session.mockRejectedValueOnce(new AppError('UNAUTHORIZED', 'Sign in', 401)); expect((await GET(request(), context)).status).toBe(401)
 m.permission.mockImplementationOnce(() => { throw new AppError('FORBIDDEN', 'No access', 403) }); expect((await GET(request(), context)).status).toBe(403)
 for (const header of ['x-flowrish-workspace', 'x-flowrish-follow-up-scope']) { const req = request('POST', '', {}); req.headers.set(header, 'other'); expect((await POST(req, context)).status).toBe(409) }
 const req = request('POST', '', {}); req.headers.set('origin', 'https://other.example'); expect((await POST(req, context)).status).toBe(403)
 expect((await POST(request('POST', '', 'invalid'), context)).status).toBe(400); expect((await POST(request('POST', '', 'x'.repeat(66000)), context)).status).toBe(413)
 for (const query of ['?userId=other', '?requestId=bad', `?requestId=${requestId}&requestId=${requestId}`]) expect((await GET(request('GET', query), context)).status).toBe(400)
 expect(m.preview).not.toHaveBeenCalled(); expect(m.receipt).not.toHaveBeenCalled(); expect(m.approve).not.toHaveBeenCalled()
})
it('redacts internal failures and preserves safe conflicts without caching private errors', async () => {
 m.approve.mockRejectedValue(new Error('private database detail')); const res = await POST(request('POST', '', {}), context); expect(res.status).toBe(503); expect(res.headers.get('cache-control')).toContain('no-store'); expect(await res.text()).not.toContain('private database')
 m.approve.mockRejectedValue(new AppError('FOLLOW_UP_CHANGED', 'Review again', 409)); expect((await POST(request('POST', '', {}), context)).status).toBe(409)
})
