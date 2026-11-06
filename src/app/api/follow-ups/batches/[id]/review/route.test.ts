import {beforeEach,expect,it,vi} from 'vitest'
import {AppError} from '@/lib/errors'
const m=vi.hoisted(()=>({session:vi.fn(),permission:vi.fn(),review:vi.fn()}))
vi.mock('@/server/auth/session',()=>({requireSession:m.session}))
vi.mock('@/server/auth/permissions',()=>({requirePermission:m.permission}))
vi.mock('@/server/services/follow-up-remaining-tasks',()=>({reviewRemainingTasks:m.review}))
import {GET} from './route'
const id='22222222-2222-4222-8222-222222222222',context={params:Promise.resolve({id})}
const request=(query='?index=0&index=2')=>new Request('https://app.example/api/follow-ups/batches/'+id+'/review'+query,{headers:{'x-flowrish-workspace':'org','x-flowrish-follow-up-scope':JSON.stringify(['org','actor'])}})
beforeEach(()=>{vi.resetAllMocks();m.session.mockResolvedValue({organizationId:'org',dbUser:{id:'actor'}})})
it('derives write-authorized scope and returns noncached previews with bounded selected ordinals',async()=>{
 const res=await GET(request(),context);expect(res.status).toBe(200);expect(res.headers.get('cache-control')).toContain('no-store');expect(m.review).toHaveBeenCalledWith('org','actor',id,{indices:[0,2]});expect(m.permission).toHaveBeenCalledWith({id:'actor'},'leads:write')
 await GET(request('?index=1&localTime=2099-11-07T09%3A00&timeZone=Asia%2FManila'),context);expect(m.review).toHaveBeenLastCalledWith('org','actor',id,{indices:[1],target:{localTime:'2099-11-07T09:00',timeZone:'Asia/Manila'}})
})
it('rejects anonymous, read-only and stale contexts before review',async()=>{
 m.session.mockRejectedValueOnce(new AppError('UNAUTHORIZED','Sign in',401));expect((await GET(request(),context)).status).toBe(401);m.permission.mockImplementationOnce(()=>{throw new AppError('FORBIDDEN','No access',403)});expect((await GET(request(),context)).status).toBe(403);const stale=request();stale.headers.set('x-flowrish-workspace','other');expect((await GET(stale,context)).status).toBe(409);expect(m.review).not.toHaveBeenCalled()
})
it('rejects extra, duplicate, missing, out-of-range or non-integer query values before services',async()=>{
 for(const query of ['', '?index=0&index=0','?index=20','?index=1.5','?index=','?index=00','?index=0&userId=other','?index=0&localTime=2099-01-01T09:00','?index=0&localTime=a&localTime=b&timeZone=Asia/Manila'])expect((await GET(request(query),context)).status).toBe(400)
 expect(m.review).not.toHaveBeenCalled()
})
