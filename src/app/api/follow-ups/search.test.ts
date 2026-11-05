import { beforeEach,expect,it,vi } from 'vitest'
import { followUpHeaders } from '@/lib/follow-up-access'
const m=vi.hoisted(()=>({session:vi.fn(),permission:vi.fn(),list:vi.fn()}))
vi.mock('@/server/auth/session',()=>({requireSession:m.session}))
vi.mock('@/server/auth/permissions',()=>({requirePermission:m.permission}))
vi.mock('@/server/services/follow-ups',()=>({listFollowUps:m.list}))
import { GET } from './route'
const context={organizationId:'org',userId:'actor'}
beforeEach(()=>{vi.resetAllMocks();m.session.mockResolvedValue({organizationId:'org',dbUser:{id:'actor'}});m.list.mockResolvedValue({items:[],canWrite:false})})
it('binds filters and retained ids to the authenticated workspace and user',async()=>{const result=await GET(new Request('https://flowrish.example.invalid/api/follow-ups?search=%20Older%20&source=CALL&dueOnly=1&retain=draft&organizationId=foreign',{headers:followUpHeaders(context)}));expect(result.status).toBe(200);expect(m.list).toHaveBeenCalledWith('org','actor','PENDING',['draft'],{search:'Older',source:'CALL',dueOnly:true});expect(m.permission).toHaveBeenCalledExactlyOnceWith({id:'actor'},'leads:read');expect(result.headers.get('cache-control')).toContain('no-store');expect(await result.json()).toEqual({data:[],scope:context,capabilities:{canWrite:false}})})
it('rejects malformed filters and stale identities before listing private work',async()=>{for(const query of ['source=other','dueOnly=true','search=a&search=b']){const response=await GET(new Request(`https://flowrish.example.invalid/api/follow-ups?${query}`,{headers:followUpHeaders(context)}));expect(response.status).toBe(400)}expect((await GET(new Request('https://flowrish.example.invalid/api/follow-ups?search=private',{headers:followUpHeaders({...context,userId:'other'})}))).status).toBe(409);expect(m.list).not.toHaveBeenCalled()})
