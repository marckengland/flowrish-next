import {beforeEach,expect,it,vi} from 'vitest'
import {AppError} from '@/lib/errors'
import {followUpHeaders} from '@/lib/follow-up-access'
const m=vi.hoisted(()=>({session:vi.fn(),permission:vi.fn(),history:vi.fn()}))
vi.mock('@/server/auth/session',()=>({requireSession:m.session}))
vi.mock('@/server/auth/permissions',()=>({requirePermission:m.permission}))
vi.mock('@/server/services/follow-up-history',()=>({listFollowUpHistory:m.history}))
import {GET} from './route'
const scope={organizationId:'org',userId:'actor'},params={params:Promise.resolve({id:'item'})},base='https://flowrish.example.invalid/api/follow-ups/item/history/export'
beforeEach(()=>{vi.resetAllMocks();m.session.mockResolvedValue({organizationId:'org',dbUser:{id:'actor'}});m.history.mockResolvedValue({data:{id:'item',exportVersion:1},canWrite:false})})
it('reads scoped export batches without write permission or caching and forwards filters and position',async()=>{
 const result=await GET(new Request(base+'?page=2&kind=restored&cursor=export_position&from=2026-11-01&to=2026-11-05&timeZone=Asia%2FManila',{headers:followUpHeaders(scope)}),params);expect(result.status).toBe(200);expect(result.headers.get('cache-control')).toContain('no-store');expect(await result.json()).toEqual({data:{id:'item',exportVersion:1},scope,capabilities:{canWrite:false}});expect(m.permission).toHaveBeenCalledExactlyOnceWith({id:'actor'},'leads:read');expect(m.history).toHaveBeenCalledWith('org','actor','item',{page:'2',kind:'restored',cursor:'export_position',from:'2026-11-01',to:'2026-11-05',timeZone:'Asia/Manila'},true,true,true)
})
it('rejects anonymous, stale or missing captured identities before reading history',async()=>{
 m.session.mockRejectedValueOnce(new AppError('UNAUTHORIZED','Authentication required',401));expect((await GET(new Request(base),params)).status).toBe(401)
 for(const headers of [{},followUpHeaders({...scope,userId:'other'}),followUpHeaders({...scope,organizationId:'other'})])expect((await GET(new Request(base,{headers}),params)).status).toBe(409)
 expect(m.history).not.toHaveBeenCalled()
})
it('rejects duplicate query fields and keeps private diagnostics out of errors',async()=>{
 for(const suffix of ['?page=1&page=2','?kind=all&kind=restored','?cursor=a&cursor=b','?from=a&from=b','?to=a&to=b','?timeZone=UTC&timeZone=Asia%2FManila'])expect((await GET(new Request(base+suffix,{headers:followUpHeaders(scope)}),params)).status).toBe(400)
 expect(m.history).not.toHaveBeenCalled();m.history.mockRejectedValue(new Error('Private raw audit and credentials'));const response=await GET(new Request(base,{headers:followUpHeaders(scope)}),params);expect(response.status).toBe(503);expect(response.headers.get('cache-control')).toContain('no-store');expect(JSON.stringify(await response.json())).not.toContain('Private')
})
