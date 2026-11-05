import { beforeEach, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
const m = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn(), preview: vi.fn(), apply: vi.fn(), enabled: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: m.session }))
vi.mock('@/server/auth/permissions', () => ({ requirePermission: m.permission }))
vi.mock('@/server/services/lead-merge', () => ({ previewLeadMerge: m.preview, applyLeadMerge: m.apply }))
vi.mock('@/server/services/lead-merge-policy', () => ({ leadMergeWritesEnabled: m.enabled }))
import { POST as preview } from './preview/route'
import { POST as apply } from './apply/route'
import { POST as legacy } from '../[id]/merge/route'
function request(body: unknown = {}, user: string | null = 'user') { return new Request('https://app.example/api/leads/merge', { method: 'POST', headers: { origin: 'https://app.example', 'content-type': 'application/json', ...(user ? { 'x-flowrish-merge-user': user } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) }) }
beforeEach(() => { vi.resetAllMocks(); m.session.mockResolvedValue({ organizationId: 'org', dbUser: { id: 'user' } }); m.enabled.mockReturnValue(true) })
it('uses session identity, all three lead permissions and private no-store responses', async () => {
  for (const response of [await preview(request({ id: 'review' })), await apply(request({ id: 'review', confirmed: true }))]) { expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store'); expect((await response.json()).scope).toEqual({ organizationId: 'org', userId: 'user' }) }
  for (const permission of ['leads:read', 'leads:write', 'leads:delete']) expect(m.permission).toHaveBeenCalledWith({ id: 'user' }, permission)
  expect(m.preview).toHaveBeenCalledWith('org', 'user', { id: 'review' }); expect(m.apply).toHaveBeenCalledWith('org', 'user', { id: 'review', confirmed: true })
})
it('rejects anonymous, missing permission, stale users, foreign origins, malformed or oversized bodies before service calls', async () => {
  m.session.mockRejectedValueOnce(new AppError('UNAUTHORIZED', 'Sign in', 401)); expect((await preview(request())).status).toBe(401)
  m.permission.mockImplementationOnce(() => { throw new AppError('FORBIDDEN', 'No delete', 403) }); expect((await preview(request())).status).toBe(403)
  for (const action of [preview, apply]) for (const user of [null, 'stale']) expect((await action(request({}, user))).status).toBe(409)
  for (const origin of ['', 'null', 'https://foreign.example']) { const req = request(); req.headers.set('origin', origin); expect((await apply(req)).status).toBe(403) }
  expect((await preview(request('bad'))).status).toBe(400); expect((await preview(request('x'.repeat(17000)))).status).toBe(413); expect(m.preview).not.toHaveBeenCalled(); expect(m.apply).not.toHaveBeenCalled()
})
it('blocks legacy immediate merging and can disable all merge writes for recovery', async () => {
  expect((await legacy(request())).status).toBe(409); m.enabled.mockReturnValue(false); expect((await apply(request({ id: 'review', confirmed: true }))).status).toBe(503); expect(m.apply).not.toHaveBeenCalled(); expect(m.preview).not.toHaveBeenCalled()
})
it('preserves stale errors and hides internal diagnostics with no-store errors', async () => {
  m.apply.mockRejectedValue(new AppError('MERGE_CHANGED', 'Fresh review required', 409)); expect((await apply(request())).status).toBe(409)
  m.preview.mockRejectedValue(new Error('private database details')); const response = await preview(request()); expect(response.status).toBe(503); expect(response.headers.get('cache-control')).toBe('no-store'); expect(await response.text()).not.toContain('private database')
})
