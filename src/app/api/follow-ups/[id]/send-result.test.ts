import {beforeEach,expect,it,vi} from 'vitest'
const m=vi.hoisted(()=>({session:vi.fn(),permission:vi.fn(),read:vi.fn()}))
vi.mock('@/server/auth/session',()=>({requireSession:m.session}))
vi.mock('@/server/auth/permissions',()=>({requirePermission:m.permission}))
vi.mock('@/server/services/email-send-results',()=>({readFollowUpSendResult:m.read}))
import {GET} from './send-result/route'
import {AppError} from '@/lib/errors'
const id='11111111-1111-4111-8111-111111111111',scope={organizationId:'org',userId:'actor'},context={params:Promise.resolve({id})}
const request=(query='',headers:Record<string,string>={})=>new Request('https://example.invalid/api/follow-ups/'+id+'/send-result'+query,{headers:{'x-flowrish-workspace':'org','x-flowrish-follow-up-scope':JSON.stringify(['org','actor']),...headers}})
beforeEach(()=>{vi.clearAllMocks();m.session.mockResolvedValue({organizationId:'org',dbUser:{id:'actor'}});m.read.mockResolvedValue({id,state:'NONE',operationId:null,updatedAt:null,result:null})})
it('returns current scoped status read-only and prevents caching',async()=>{const response=await GET(request(),context);expect(response.status).toBe(200);expect(await response.json()).toMatchObject({data:{id,state:'NONE'},scope,capabilities:{canWrite:true}});expect(response.headers.get('cache-control')).toContain('no-store');expect(m.read).toHaveBeenCalledWith('org','actor',id);expect(m.permission).toHaveBeenCalledWith(expect.anything(),'leads:write')})
it('denies anonymous and stale actor reads before touching the ledger',async()=>{m.session.mockRejectedValueOnce(new AppError('UNAUTHORIZED','Sign in.',401));expect((await GET(request(),context)).status).toBe(401);expect((await GET(request('',{'x-flowrish-follow-up-scope':'old'}),context)).status).toBe(409);expect(m.read).not.toHaveBeenCalled()})
it('rejects query credentials and invalid IDs and redacts unexpected failures',async()=>{expect((await GET(request('?token=synthetic'),context)).status).toBe(400);expect((await GET(request(),{params:Promise.resolve({id:'bad'})})).status).toBe(400);expect(m.read).not.toHaveBeenCalled();m.read.mockRejectedValue(new Error('private query detail'));const response=await GET(request(),context);expect(response.status).toBe(503);expect(JSON.stringify(await response.json())).not.toContain('private query detail')})
