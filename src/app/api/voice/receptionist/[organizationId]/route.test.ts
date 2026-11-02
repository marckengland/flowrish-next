import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ voice: vi.fn(), context: vi.fn(), handle: vi.fn() }))
vi.mock('@/server/db/client', () => ({ prisma: { voiceConfig: { findUnique: mocks.voice } } }))
vi.mock('@/server/services/voice', () => ({ getTwilioWebhookContext: mocks.context }))
vi.mock('@/server/services/receptionist', () => ({ handleReceptionistCall: mocks.handle }))
import { POST } from './route'

const orgId = '11111111-1111-4111-8111-111111111111'
const url = `https://crm.example.com/api/voice/receptionist/${orgId}?turn=1`
const params = { CallSid: `CA${'a'.repeat(32)}`, AccountSid: `AC${'a'.repeat(32)}`, Direction: 'inbound', From: '+639181234567', To: '+639171234567', SpeechResult: 'Jane Smith' }
function request(changes: Partial<typeof params> = {}, signature = true, signedUrl = url) {
  const body = { ...params, ...changes }
  const data = signedUrl + Object.keys(body).sort().map((key) => key + body[key as keyof typeof body]).join('')
  return new NextRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(signature ? { 'x-twilio-signature': createHmac('sha1', 'test-auth-token').update(data).digest('base64') } : {}) }, body: new URLSearchParams(body).toString() })
}
const context = { params: Promise.resolve({ organizationId: orgId }) }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.voice.mockResolvedValue({ twilioAccountSid: params.AccountSid, twilioCallerId: params.To })
  mocks.context.mockResolvedValue({ authToken: 'test-auth-token' })
  mocks.handle.mockResolvedValue('<Response><Say>Hello</Say></Response>')
})

describe('signed inbound receptionist webhook', () => {
  it('accepts a signature that includes the full query string', async () => {
    const response = await POST(request(), context)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('Hello')
    expect(mocks.handle).toHaveBeenCalledWith(orgId, expect.objectContaining({ turn: 1, callSid: params.CallSid, speech: 'Jane Smith' }))
  })
  it('rejects missing signatures, missing credentials and query tampering before processing', async () => {
    expect((await POST(request({}, false), context)).status).toBe(403)
    expect((await POST(request({}, true, url.replace('turn=1', 'turn=0')), context)).status).toBe(403)
    mocks.context.mockResolvedValue({ authToken: null })
    expect((await POST(request(), context)).status).toBe(403)
    expect(mocks.handle).not.toHaveBeenCalled()
  })
  it('rejects a different account or destination even with a valid signature', async () => {
    expect((await POST(request({ AccountSid: `AC${'b'.repeat(32)}` }), context)).status).toBe(403)
    expect((await POST(request({ To: '+639191234567' }), context)).status).toBe(403)
    expect(mocks.handle).not.toHaveBeenCalled()
  })
  it('rejects outbound calls and malformed call identifiers', async () => {
    expect((await POST(request({ Direction: 'outbound-api' }), context)).status).toBe(400)
    expect((await POST(request({ CallSid: 'invalid' }), context)).status).toBe(400)
    expect(mocks.handle).not.toHaveBeenCalled()
  })
  it('does not expose internal failures or claim an unsuccessful request was saved', async () => {
    mocks.handle.mockRejectedValue(new Error('secret-database-detail'))
    const response = await POST(request(), context)
    const body = await response.text()
    expect(body).not.toContain('secret-database-detail')
    expect(body).toContain('could not finish')
    expect(body).not.toContain('has been saved')
  })
})
