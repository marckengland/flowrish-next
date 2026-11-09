import {cleanup,render,screen} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
const m=vi.hoisted(()=>({session:vi.fn(),permission:vi.fn()}))
vi.mock('@/server/auth/session',()=>({requireSession:m.session}))
vi.mock('@/server/auth/permissions',()=>({hasPermission:m.permission}))
vi.mock('@/components/email/email-sync-status',()=>({EmailSyncStatus:()=>null}))
vi.mock('@/components/follow-ups/follow-up-inbox',()=>({FollowUpInbox:({initialSendStatusTab,initialReplyId,emailMatchContext}:{initialSendStatusTab?:string;initialReplyId?:string;emailMatchContext:{organizationId:string;userId:string}})=><div><p>{initialSendStatusTab??'No summary entry'}</p><p>{emailMatchContext.organizationId}:{emailMatchContext.userId}</p><p>{initialReplyId}</p></div>}))
import Page from './page'
beforeEach(()=>{vi.resetAllMocks();m.session.mockResolvedValue({organizationId:'org',dbUser:{id:'actor'}});m.permission.mockReturnValue(true)})
afterEach(cleanup)
it('forwards the strict summary destination and authenticated identity',async()=>{render(await Page({searchParams:Promise.resolve({needsChecking:'1',status:'SNOOZED'})}));expect(screen.getByText('SNOOZED')).toBeInTheDocument();expect(screen.getByText('org:actor')).toBeInTheDocument()})
it.each([{needsChecking:['1','1'],status:'PENDING'}, {needsChecking:'1',status:['APPROVED','SNOOZED']}, {needsChecking:'1',status:'UNKNOWN'}])('does not activate malformed summary parameters %j',async query=>{render(await Page({searchParams:Promise.resolve(query)}));expect(screen.getByText('No summary entry')).toBeInTheDocument()})
it('does not request private send filtering for a read-only user',async()=>{m.permission.mockImplementation((_:unknown,key:string)=>key==='leads:read');render(await Page({searchParams:Promise.resolve({needsChecking:'1',status:'APPROVED'})}));expect(screen.getByText('No summary entry')).toBeInTheDocument()})
it('keeps notification targeting independent of summary parameters',async()=>{const id='11111111-1111-4111-8111-111111111111';render(await Page({searchParams:Promise.resolve({needsChecking:'1',status:'APPROVED',reply:id})}));expect(screen.getByText('No summary entry')).toBeInTheDocument();expect(screen.getByText(id)).toBeInTheDocument()})
it('denies unreadable inboxes before rendering summary data',async()=>{m.permission.mockReturnValue(false);render(await Page({searchParams:Promise.resolve({needsChecking:'1'})}));expect(screen.getByText(/permission to view follow-ups/)).toBeInTheDocument();expect(screen.queryByText('org:actor')).not.toBeInTheDocument()})
