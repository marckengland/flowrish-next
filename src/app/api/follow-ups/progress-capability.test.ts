import {beforeEach,expect,it,vi} from 'vitest'
import {FOLLOW_UP_PAGE_HEADER} from '@/lib/follow-up-page'
import {followUpHeaders} from '@/lib/follow-up-access'
const m=vi.hoisted(()=>({session:vi.fn(),permission:vi.fn(),list:vi.fn()}))
vi.mock('@/server/auth/session',()=>({requireSession:m.session}))
vi.mock('@/server/auth/permissions',()=>({requirePermission:m.permission}))
vi.mock('@/server/services/follow-ups',()=>({listFollowUps:m.list}))
import {GET} from './route'
const scope={organizationId:'org',userId:'actor'},headers={...followUpHeaders(scope),[FOLLOW_UP_PAGE_HEADER]:'1'}
beforeEach(()=>{vi.resetAllMocks();m.session.mockResolvedValue({organizationId:'org',dbUser:{id:'actor'}});m.list.mockResolvedValue({items:[],canWrite:false,page:{nextCursor:null,accessVersion:'a'.repeat(64),callbackCatchUp:{created:5,hasMore:true}}})})
it('keeps the strict existing page shape for an already-open client without the progress capability',async()=>{const response=await GET(new Request('https://example.invalid/api/follow-ups',{headers}));expect(response.status).toBe(200);expect((await response.json()).page).toEqual({nextCursor:null,accessVersion:'a'.repeat(64)})})
it('returns progress only to a scoped client explicitly requesting that capability',async()=>{const response=await GET(new Request('https://example.invalid/api/follow-ups',{headers:{...headers,'x-flowrish-callback-progress':'1'}}));expect(response.status).toBe(200);expect((await response.json()).page).toEqual({nextCursor:null,accessVersion:'a'.repeat(64),callbackCatchUp:{created:5,hasMore:true}})})
it('rejects invalid or unpaged progress capabilities before the service',async()=>{expect((await GET(new Request('https://example.invalid/api/follow-ups',{headers:{...headers,'x-flowrish-callback-progress':'2'}}))).status).toBe(400);expect((await GET(new Request('https://example.invalid/api/follow-ups',{headers:{...followUpHeaders(scope),'x-flowrish-callback-progress':'1'}}))).status).toBe(400);expect(m.list).not.toHaveBeenCalled()})
