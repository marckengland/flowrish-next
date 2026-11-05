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
 expect(result.status).toBe(200);expect(result.headers.get('cache-control')).toContain('no-store');expect(await result.json()).toEqual({data:{id:'followup'},scope,capabilities:{canWrite:false}});expect(m.history).toHaveBeenCalledWith('org','actor','followup',{page:'2'});expect(m.permission).toHaveBeenCalledExactlyOnceWith({id:'actor'},'leads:read')
})
it('rejects missing or stale captured identities before the history service executes',async()=>{
 for(const headers of [{},followUpHeaders({...scope,userId:'other'}),followUpHeaders({...scope,organizationId:'other'})]) {const result=await GET(new Request('https://flowrish.example.invalid/api/follow-ups/followup/history',{headers}),params);expect(result.status).toBe(409);expect(result.headers.get('cache-control')).toContain('no-store')}
 expect(m.history).not.toHaveBeenCalled()
})
it('does not leak internal audit diagnostics on failure',async()=>{
 m.history.mockRejectedValue(new Error('Private audit JSON and database diagnostic'));const result=await GET(new Request('https://flowrish.example.invalid/api/follow-ups/followup/history',{headers:followUpHeaders(scope)}),params);expect(result.status).toBe(503);expect(JSON.stringify(await result.json())).not.toContain('Private audit');expect(result.headers.get('cache-control')).toContain('no-store')
})
