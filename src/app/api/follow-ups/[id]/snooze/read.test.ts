import {beforeEach,expect,it,vi} from 'vitest'
import {followUpHeaders} from '@/lib/follow-up-access'
const m=vi.hoisted(()=>({session:vi.fn(),permission:vi.fn(),read:vi.fn(),change:vi.fn()}))
vi.mock('@/server/auth/session',()=>({requireSession:m.session}))
vi.mock('@/server/auth/permissions',()=>({requirePermission:m.permission}))
vi.mock('@/server/services/follow-up-snooze',()=>({readFollowUpSnooze:m.read,changeFollowUpSnooze:m.change}))
import {GET} from './route'
const scope={organizationId:'org',userId:'actor'},params={params:Promise.resolve({id:'a'})},headers=followUpHeaders(scope)
beforeEach(()=>{vi.resetAllMocks();m.session.mockResolvedValue({organizationId:'org',dbUser:{id:'actor'}});m.read.mockResolvedValue({data:{id:'a',snoozeVersion:'a'.repeat(64),snooze:null},canWrite:false})})
it('confirms reminders with a scoped private GET and no write permission or mutation',async()=>{const response=await GET(new Request('https://example.invalid/api/follow-ups/a/snooze?organizationId=foreign',{headers}),params);expect(response.status).toBe(200);expect(m.read).toHaveBeenCalledWith('org','actor','a');expect(m.permission).toHaveBeenCalledWith({id:'actor'},'leads:read');expect(m.permission).not.toHaveBeenCalledWith(expect.anything(),'leads:write');expect(m.change).not.toHaveBeenCalled();expect(response.headers.get('cache-control')).toContain('no-store');expect(await response.json()).toEqual({data:{id:'a',snoozeVersion:'a'.repeat(64),snooze:null},scope,capabilities:{canWrite:false}})})
it('rejects stale account headers and invalid IDs before reading reminder data',async()=>{expect((await GET(new Request('https://example.invalid/api/follow-ups/a/snooze',{headers:{...headers,'x-flowrish-follow-up-scope':'["org","other"]'}}),params)).status).toBe(409);expect((await GET(new Request('https://example.invalid/api/follow-ups/a/snooze',{headers}),{params:Promise.resolve({id:''})})).status).toBe(400);expect(m.read).not.toHaveBeenCalled()})
