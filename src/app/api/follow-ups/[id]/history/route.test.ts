import { beforeEach, expect, it, vi } from 'vitest'
import { followUpHeaders } from '@/lib/follow-up-access'
const m=vi.hoisted(()=>({session:vi.fn(),permission:vi.fn(),history:vi.fn()}))
vi.mock('@/server/auth/session',()=>({requireSession:m.session}))
vi.mock('@/server/auth/permissions',()=>({requirePermission:m.permission}))
vi.mock('@/server/services/follow-up-history',()=>({listFollowUpHistory:m.history}))
import { GET } from './route'
const scope={organizationId:'org',userId:'actor'},params={params:Promise.resolve({id:'followup'})}
beforeEach(()=>{vi.resetAllMocks();m.session.mockResolvedValue({organizationId:'org',dbUser:{id:'actor'}});m.history.mockResolvedValue({data:{id:'followup'},canWrite:false})})
it('serves a read-only scoped history receipt without caching or requiring write permission',async()=>{
 const result=await GET(new Request('https://flowrish.example.invalid/api/follow-ups/followup/history?page=2',{headers:followUpHeaders(scope)}),params)
 expect(result.status).toBe(200);expect(result.headers.get('cache-control')).toContain('no-store');expect(await result.json()).toEqual({data:{id:'followup'},scope,capabilities:{canWrite:false}});expect(m.history).toHaveBeenCalledWith('org','actor','followup',{page:'2'},false,false);expect(m.permission).toHaveBeenCalledExactlyOnceWith({id:'actor'},'leads:read')
})
it('rejects missing or stale captured identities before the history service executes',async()=>{
 for(const headers of [{},followUpHeaders({...scope,userId:'other'}),followUpHeaders({...scope,organizationId:'other'})]) {const result=await GET(new Request('https://flowrish.example.invalid/api/follow-ups/followup/history',{headers}),params);expect(result.status).toBe(409);expect(result.headers.get('cache-control')).toContain('no-store')}
 expect(m.history).not.toHaveBeenCalled()
})
it('does not leak internal audit diagnostics on failure',async()=>{
 m.history.mockRejectedValue(new Error('Private audit JSON and database diagnostic'));const result=await GET(new Request('https://flowrish.example.invalid/api/follow-ups/followup/history',{headers:followUpHeaders(scope)}),params);expect(result.status).toBe(503);expect(JSON.stringify(await result.json())).not.toContain('Private audit');expect(result.headers.get('cache-control')).toContain('no-store')
})
it('forwards the selected action and matching page through the scoped read-only route',async()=>{
 const result=await GET(new Request('https://flowrish.example.invalid/api/follow-ups/followup/history?page=2&kind=restored',{headers:followUpHeaders(scope)}),params);expect(result.status).toBe(200);expect(result.headers.get('cache-control')).toContain('no-store');expect(m.history).toHaveBeenCalledWith('org','actor','followup',{page:'2',kind:'restored'},false,false);expect(m.permission).toHaveBeenCalledExactlyOnceWith({id:'actor'},'leads:read')
})

it('opts into stable paging and rejects duplicate or unsupported paging values read-only',async()=>{
 const headers={...followUpHeaders(scope),'x-flowrish-history-page':'1'};const result=await GET(new Request('https://flowrish.example.invalid/api/follow-ups/followup/history?page=2&cursor=synthetic_position',{headers}),params);expect(result.status).toBe(200);expect(m.history).toHaveBeenCalledWith('org','actor','followup',{page:'2',cursor:'synthetic_position'},true,false);m.history.mockClear();for(const url of ['?page=1&page=2','?kind=all&kind=restored','?cursor=a&cursor=b'])expect((await GET(new Request('https://flowrish.example.invalid/api/follow-ups/followup/history'+url,{headers}),params)).status).toBe(400);expect((await GET(new Request('https://flowrish.example.invalid/api/follow-ups/followup/history',{headers:{...headers,'x-flowrish-history-page':'2'}}),params)).status).toBe(400);expect(m.history).not.toHaveBeenCalled()
})
it('negotiates date-aware stable reads and rejects ambiguous range parameters before the service',async()=>{
 const headers={...followUpHeaders(scope),'x-flowrish-history-page':'1','x-flowrish-history-dates':'1'},base='https://flowrish.example.invalid/api/follow-ups/followup/history'
 const result=await GET(new Request(base+'?from=2026-11-01&to=2026-11-05&timeZone=Asia%2FManila',{headers}),params);expect(result.status).toBe(200);expect(result.headers.get('cache-control')).toContain('no-store');expect(m.history).toHaveBeenCalledWith('org','actor','followup',{from:'2026-11-01',to:'2026-11-05',timeZone:'Asia/Manila'},true,true);m.history.mockClear()
 for(const suffix of ['?from=a&from=b','?to=a&to=b','?timeZone=UTC&timeZone=Asia%2FManila'])expect((await GET(new Request(base+suffix,{headers}),params)).status).toBe(400)
 expect((await GET(new Request(base,{headers:{...followUpHeaders(scope),'x-flowrish-history-dates':'1'}}),params)).status).toBe(400);expect(m.history).not.toHaveBeenCalled()
})
