import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn(), list: vi.fn(), views: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: m.session }))
vi.mock('@/server/auth/permissions', () => ({ requirePermission: m.permission }))
vi.mock('@/server/services/follow-ups', () => ({ listFollowUps: m.list }))
vi.mock('@/server/services/saved-follow-up-views', () => ({ listSavedFollowUpViews: m.views }))
import { GET } from './route'
import { GET as viewsGET } from '../follow-up-views/route'
function request(path = '/api/follow-ups?status=APPROVED&taskProgress=OPEN', progress: string | null = '1') { return new Request(`https://app.example${path}`, { headers: { 'x-flowrish-workspace': 'org', 'x-flowrish-follow-up-scope': JSON.stringify(['org', 'actor']), ...(progress === null ? {} : { 'x-flowrish-task-progress': progress }) } }) }
beforeEach(() => { vi.resetAllMocks(); m.session.mockResolvedValue({ organizationId: 'org', dbUser: { id: 'actor' } }); m.list.mockResolvedValue({ items: [], canWrite: false }); m.views.mockResolvedValue([]) })
it('requires opt-in and advertises support without requesting write permission or caching data', async () => {
 const res = await GET(request()); expect(res.status).toBe(200); expect((await res.json()).capabilities).toEqual({ canWrite: false, taskProgress: true, inboxCounts: true, composeDrafts: true }); expect(res.headers.get('cache-control')).toContain('no-store'); expect(m.list).toHaveBeenCalledWith('org', 'actor', 'APPROVED', [], { search: '', source: 'ALL', dueOnly: false, taskProgress: 'OPEN' }, undefined, true); expect(m.permission).not.toHaveBeenCalledWith(expect.anything(), 'leads:write')
})
it('rejects absent/invalid opt-in and stale scope before any progress service call', async () => {
 expect((await GET(request(undefined, null))).status).toBe(400); expect((await GET(request(undefined, 'yes'))).status).toBe(400); const req = request(); req.headers.set('x-flowrish-workspace', 'foreign'); expect((await GET(req)).status).toBe(409); expect(m.list).not.toHaveBeenCalled()
})
it('asks saved-view readers for progress awareness only when the client opts in', async () => {
 expect((await viewsGET(request('/api/follow-up-views'))).status).toBe(200); expect(m.views).toHaveBeenLastCalledWith('org', 'actor', true)
 expect((await viewsGET(request('/api/follow-up-views', null))).status).toBe(200); expect(m.views).toHaveBeenLastCalledWith('org', 'actor')
})
