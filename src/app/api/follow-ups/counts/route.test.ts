import {beforeEach,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
import {AppError} from '@/lib/errors'
const mocks=vi.hoisted(()=>({session:vi.fn(),permission:vi.fn(),counts:vi.fn()}))
vi.mock('@/server/auth/session',()=>({requireSession:mocks.session}))
vi.mock('@/server/auth/permissions',()=>({requirePermission:mocks.permission}))
vi.mock('@/server/services/follow-up-counts',()=>({readFollowUpCounts:mocks.counts}))
import {GET} from './route'
const headers={'x-flowrish-workspace':'org','x-flowrish-follow-up-scope':JSON.stringify(['org','actor'])}
const receipt={counts:{PENDING:125,APPROVED:8,DISMISSED:2,SNOOZED:3},overdueTasks:2,checkedAt:'2026-11-06T01:00:00.000Z',filters:{search:'',source:'ALL',dueOnly:false}}
beforeEach(()=>{vi.resetAllMocks();mocks.session.mockResolvedValue({organizationId:'org',dbUser:{id:'actor'}});mocks.counts.mockResolvedValue({data:receipt,canWrite:false})})
it('returns scoped private no-store read-only counts using the authenticated identity',async()=>{const response=await GET(new NextRequest('https://example.invalid/api/follow-ups/counts?source=EMAIL',{headers}));expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');expect(mocks.counts).toHaveBeenCalledWith('org','actor',{search:'',source:'EMAIL',dueOnly:false});expect(mocks.permission).toHaveBeenCalledWith({id:'actor'},'leads:read');expect(mocks.permission).not.toHaveBeenCalledWith(expect.anything(),'leads:write');expect(await response.json()).toEqual({data:receipt,scope:{organizationId:'org',userId:'actor'},capabilities:{canWrite:false}})})
it.each(['status=APPROVED','organizationId=other','retain=private','after=page','search=a&search=b','source=OTHER','dueOnly=1&taskProgress=OPEN'])('rejects unsupported/invalid query %s without reading counts',async query=>{const response=await GET(new NextRequest('https://example.invalid/api/follow-ups/counts?'+query,{headers}));expect(response.status).toBe(400);expect(mocks.counts).not.toHaveBeenCalled()})
it.each([401,403])('denies unauthorized read %s without private data',async status=>{mocks.session.mockRejectedValue(new AppError(status===401?'UNAUTHORIZED':'FORBIDDEN','Denied',status));const response=await GET(new NextRequest('https://example.invalid/api/follow-ups/counts',{headers}));expect(response.status).toBe(status);expect(response.headers.get('cache-control')).toContain('no-store');expect(await response.json()).not.toHaveProperty('data');expect(mocks.counts).not.toHaveBeenCalled()})
it('rejects stale workspace/account headers without a service call',async()=>{const response=await GET(new NextRequest('https://example.invalid/api/follow-ups/counts',{headers:{...headers,'x-flowrish-follow-up-scope':JSON.stringify(['org','other'])}}));expect(response.status).toBe(409);expect(mocks.counts).not.toHaveBeenCalled()})
