import {beforeEach,expect,it,vi} from 'vitest'
import {FOLLOW_UP_PAGE_HEADER} from '@/lib/follow-up-page'
import {followUpHeaders} from '@/lib/follow-up-access'
const m=vi.hoisted(()=>({session:vi.fn(),permission:vi.fn(),list:vi.fn()}))
vi.mock('@/server/auth/session',()=>({requireSession:m.session}))
vi.mock('@/server/auth/permissions',()=>({requirePermission:m.permission}))
vi.mock('@/server/services/follow-ups',()=>({listFollowUps:m.list}))
import {GET} from './route'
const scope={organizationId:'org',userId:'actor'},headers={...followUpHeaders(scope),[FOLLOW_UP_PAGE_HEADER]:'1'}
beforeEach(()=>{vi.resetAllMocks();m.session.mockResolvedValue({organizationId:'org',dbUser:{id:'actor'}});m.list.mockResolvedValue({items:[],canWrite:false,page:{nextCursor:null,accessVersion:'a'.repeat(64)}})})
it('passes bounded opt-in paging/filter/retained inputs and optional metadata under the session scope',async()=>{const response=await GET(new Request('https://example.invalid/api/follow-ups?search=Older&after=cursorA&retain=draft&organizationId=foreign',{headers}));expect(response.status).toBe(200);expect(m.list).toHaveBeenCalledWith('org','actor','PENDING',['draft'],{search:'Older',source:'ALL',dueOnly:false},{after:'cursorA'});expect(await response.json()).toEqual({data:[],page:{nextCursor:null,accessVersion:'a'.repeat(64)},scope,capabilities:{canWrite:false,inboxCounts:true,composeDrafts:true,sendResults:true}});expect(response.headers.get('cache-control')).toContain('no-store')})
it('rejects ambiguous paging inputs and stale identities before listing',async()=>{for(const query of ['after=a&after=b','after=!'])expect((await GET(new Request(`https://example.invalid/api/follow-ups?${query}`,{headers}))).status).toBe(400);expect((await GET(new Request('https://example.invalid/api/follow-ups?after=a',{headers:followUpHeaders(scope)}))).status).toBe(400);expect((await GET(new Request('https://example.invalid/api/follow-ups',{headers:{...headers,'x-flowrish-follow-up-scope':JSON.stringify(['org','other'])}}))).status).toBe(409);expect(m.list).not.toHaveBeenCalled()})
