import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn(), prepare: vi.fn(), send: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: mocks.session }))
vi.mock('@/server/auth/permissions', () => ({ requirePermission: mocks.permission }))
vi.mock('@/server/services/follow-up-drafts', () => ({ prepareFollowUpSend: mocks.prepare }))
vi.mock('@/server/services/email', () => ({ sendEmail: mocks.send }))
import { POST } from './route'
const leadId = '11111111-1111-4111-8111-111111111111'
const followUpId = '22222222-2222-4222-8222-222222222222'
const draftVersion = '33333333-3333-4333-8333-333333333333'
const payload = { leadId, subject: 'Reviewed subject', body: '<p>Reviewed reply</p>', followUpId, draftVersion }
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ organizationId: 'org', dbUser: { id: 'user' } }); mocks.prepare.mockResolvedValue({ threadId: 'source-thread', subject: 'Reviewed subject', options: { accountId: 'exact-account', recipientEmail: 'alternate@example.invalid' } }); mocks.send.mockResolvedValue({ messageId: 'sent' }) })
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
