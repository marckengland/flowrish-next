import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn(), prepare: vi.fn(), send: vi.fn(), track:vi.fn(), read:vi.fn(), template:vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: mocks.session }))
vi.mock('@/server/auth/permissions', () => ({ requirePermission: mocks.permission }))
vi.mock('@/server/services/follow-up-drafts', () => ({ prepareFollowUpSend: mocks.prepare, prepareFollowUpTemplateSend:mocks.template }))
vi.mock('@/server/services/email-send-results',()=>({trackFollowUpSend:mocks.track,readFollowUpSendResult:mocks.read}))
vi.mock('@/server/services/email', () => ({ sendEmail: mocks.send }))
import { POST } from './route'
const leadId = '11111111-1111-4111-8111-111111111111'
const followUpId = '22222222-2222-4222-8222-222222222222'
const draftVersion = '33333333-3333-4333-8333-333333333333'
const payload = { leadId, subject: 'Reviewed subject', body: '<p>Reviewed reply</p>', followUpId, draftVersion }
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ organizationId: 'org', dbUser: { id: 'user' } }); mocks.prepare.mockResolvedValue({ threadId: 'source-thread', subject: 'Reviewed subject', options: { accountId: 'exact-account', recipientEmail: 'alternate@example.invalid' } }); mocks.send.mockResolvedValue({ messageId: 'sent' }); mocks.track.mockImplementation(async(_org,_user,_id,_input,_files,deliver)=>deliver()); mocks.read.mockResolvedValue({state:'CONFIRMED'});mocks.template.mockResolvedValue({options:{followUpTemplateId:followUpId}}) })
const request = (data: unknown) => new NextRequest('https://example.com/api/email/send', { method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'https://example.com', 'x-flowrish-workspace': 'org', 'x-flowrish-follow-up-scope': JSON.stringify(['org', 'user']) }, body: JSON.stringify(data) })
describe('reviewed conversation draft sending', () => {
  it('binds the explicit send to the validated source context', async () => {
    expect((await POST(request(payload))).status).toBe(200)
    expect(mocks.prepare).toHaveBeenCalledWith('org','user',followUpId,draftVersion,leadId)
    expect(mocks.send).toHaveBeenCalledWith(leadId,payload.subject,payload.body,'user','org','source-thread',[],{ accountId: 'exact-account', recipientEmail: 'alternate@example.invalid', manualActor: true })
  })
  it('rejects missing version pairs and an arbitrary thread override before sending', async () => {
    expect((await POST(request({ ...payload, followUpId: undefined }))).status).toBe(400)
    expect((await POST(request({ ...payload, threadId: 'other-thread' }))).status).toBe(409)
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('rejects a client subject that would split the verified conversation', async () => {
    expect((await POST(request({ ...payload, subject: 'Different subject' }))).status).toBe(409)
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('preserves legacy explicit send behavior without a generated draft', async () => {
    expect((await POST(request({ leadId, subject: 'Manual subject', body: 'Manual body' }))).status).toBe(200)
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(mocks.send).toHaveBeenCalledWith(leadId,'Manual subject','Manual body','user','org',undefined,[],{ manualActor: true })
  })
})
it('recovers a confirmed replay without querying the changed conversation or calling transport',async()=>{mocks.track.mockResolvedValue({messageId:'sent',threadId:'source-thread',attachmentCount:0});mocks.prepare.mockRejectedValue(new Error('Synthetic provider outage after acceptance'));const response=await POST(request({...payload,operationId:'44444444-4444-4444-8444-444444444444'}));expect(response.status).toBe(200);expect((await response.json()).data).toEqual({messageId:'sent',threadId:'source-thread',attachmentCount:0});expect(mocks.prepare).not.toHaveBeenCalled();expect(mocks.send).not.toHaveBeenCalled();expect(mocks.read).toHaveBeenCalledWith('org','user',followUpId)})
it('protects legacy follow-up templates without a client operation ID and forwards the durable hooks',async()=>{const hooks={beforeDelivery:vi.fn(),accepted:vi.fn()};mocks.track.mockImplementation(async(_org,_user,_id,_input,_files,deliver)=>deliver(hooks));const response=await POST(request({leadId,subject:'Template subject',body:'Template body',followUpId}));expect(response.status).toBe(200);expect(mocks.track).toHaveBeenCalledWith('org','user',followUpId,{leadId,subject:'Template subject',body:'Template body'},[],expect.any(Function));expect(mocks.template).toHaveBeenCalledWith('org','user',followUpId,leadId);expect(mocks.send).toHaveBeenCalledWith(leadId,'Template subject','Template body','user','org',undefined,[],{followUpTemplateId:followUpId,manualActor:true,deliveryHooks:hooks})})
