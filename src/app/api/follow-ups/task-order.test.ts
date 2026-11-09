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
it('requires explicit ordering support, progress and paging without write permission', async () => {
 const req = request('/api/follow-ups?status=APPROVED&taskOrder=DUE_ASC'); req.headers.set('x-flowrish-task-order','1'); req.headers.set('x-flowrish-follow-up-page','1')
 expect((await GET(req)).status).toBe(200); expect(m.list).toHaveBeenLastCalledWith('org','actor','APPROVED',[],{search:'',source:'ALL',dueOnly:false,taskOrder:'DUE_ASC'},{},true,true)
 const body = await (await GET(req)).json(); expect(body.capabilities).toEqual({canWrite:false,taskProgress:true,taskOrder:true,inboxCounts:true,composeDrafts:true,sendResults:true}); expect(m.permission).not.toHaveBeenCalledWith(expect.anything(),'leads:write')
 for(const header of ['x-flowrish-task-order','x-flowrish-task-progress','x-flowrish-follow-up-page']) { const invalid = new Request(req); invalid.headers.delete(header); m.list.mockClear(); expect((await GET(invalid)).status).toBe(400); expect(m.list).not.toHaveBeenCalled() }
})
it('opts saved readers into order independently from older progress readers', async () => {
 const req = request('/api/follow-up-views'); req.headers.set('x-flowrish-task-order','1'); expect((await viewsGET(req)).status).toBe(200); expect(m.views).toHaveBeenLastCalledWith('org','actor',true,true)
})
