import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
const mocks = vi.hoisted(() => ({ embed: vi.fn(), session: vi.fn(), message: vi.fn(), callback: vi.fn() }))
vi.mock('@/server/services/website-receptionist', () => ({ getWebsiteReceptionistEmbed: mocks.embed, startWebsiteSession: mocks.session, sendWebsiteMessage: mocks.message, submitWebsiteCallback: mocks.callback }))
import { GET } from './[publicId]/embed/route'
import { POST as SESSION } from './[publicId]/session/route'
import { POST as MESSAGE } from './[publicId]/message/route'
import { POST as CALLBACK } from './[publicId]/callback/route'
const id = '11111111-1111-4111-8111-111111111111', token = 'a'.repeat(64)
const context = { params: Promise.resolve({ publicId: id }) }
function request(body: string, extra: Record<string, string> = {}) { return new Request('https://app.example/api/public/widget', { method: 'POST', headers: { origin: 'https://app.example', 'x-forwarded-for': '203.0.113.8, 10.0.0.1', authorization: `Bearer ${token}`, ...extra }, body }) }
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ token }); mocks.message.mockResolvedValue({ reply: 'Approved answer', turn: 1, canMessage: true }); mocks.callback.mockResolvedValue({ received: true }); mocks.embed.mockResolvedValue({ publicId: id, siteOrigin: 'https://business.example', allowedOrigins: ['https://business.example'], businessName: 'Sample Business' }) })
describe('website receptionist public HTTP boundary', () => {
  it('uses only server route identity, bearer and validated request context', async () => {
    const input = { question: 'How much?', organizationId: 'untrusted' }
    for (const response of [await SESSION(request('{}'), context), await MESSAGE(request(JSON.stringify(input)), context), await CALLBACK(request('{"confirmed":true}'), context)]) {
      expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store'); expect(response.headers.get('access-control-allow-origin')).toBeNull(); expect(response.headers.get('x-frame-options')).toBe('DENY')
    }
    expect(mocks.session).toHaveBeenCalledWith(id, {}, { ip: '203.0.113.8', origin: 'https://app.example' })
    expect(mocks.message).toHaveBeenCalledWith(id, token, input, { ip: '203.0.113.8', origin: 'https://app.example' })
    expect(mocks.callback).toHaveBeenCalledWith(id, token, { confirmed: true }, { ip: '203.0.113.8', origin: 'https://app.example' })
  })
  it('fails closed for missing/foreign origins, IPs and bearer tokens before service calls', async () => {
    for (const extra of ([{ origin: '' }, { origin: 'null' }, { origin: 'https://business.example' }, { 'x-forwarded-for': '' }, { 'x-forwarded-for': 'fake' }, { authorization: '' }, { authorization: 'Bearer secret' }] as Record<string, string>[])) expect((await MESSAGE(request('{}', extra), context)).status).toBe(403)
    expect(mocks.message).not.toHaveBeenCalled()
  })
  it('bounds streamed JSON and rejects malformed input without exposing exceptions', async () => {
    expect((await MESSAGE(request('bad JSON'), context)).status).toBe(400)
    expect((await MESSAGE(request(JSON.stringify({ question: 'x'.repeat(9000) })), context)).status).toBe(413)
    expect((await MESSAGE(request('{}', { 'content-length': '9000' }), context)).status).toBe(413)
    expect(mocks.message).not.toHaveBeenCalled()
    mocks.message.mockRejectedValue(new Error('secret provider credential'))
    const response = await MESSAGE(request('{}'), context)
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('secret')
    mocks.message.mockRejectedValue(new AppError('WEBSITE_LIMIT_REACHED', 'secret exception detail', 429))
    const limited = await MESSAGE(request('{}'), context)
    expect(limited.status).toBe(429); expect(await limited.text()).not.toContain('secret')
  })
  it('allows embedding only with tenant-specific CSP and fresh nonce, without X-Frame-Options', async () => {
    const responses = await Promise.all([GET(new Request('https://app.example/embed?origin=https://business.example'), context), GET(new Request('https://app.example/embed?origin=https://business.example'), context)])
    for (const response of responses) { expect(response.status).toBe(200); expect(response.headers.get('x-frame-options')).toBeNull(); expect(response.headers.get('content-security-policy')).toContain('frame-ancestors https://business.example'); expect(response.headers.get('content-security-policy')).toContain("form-action 'none'"); expect(response.headers.get('cache-control')).toBe('no-store'); expect(await response.text()).toContain('Sample Business') }
    expect(responses[0].headers.get('content-security-policy')).not.toBe(responses[1].headers.get('content-security-policy'))
  })
  it('denies framing and emits static content on disabled, invalid or failed embeds', async () => {
    for (const query of ['', '?origin=https://a.example&origin=https://b.example', '?origin=https://evil.example/path', '?origin=https://a.example&unexpected=x']) {
      const response = await GET(new Request(`https://app.example/embed${query}`), context)
      expect(response.status).toBe(400); expect(response.headers.get('x-frame-options')).toBe('DENY'); expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    }
    expect(mocks.embed).not.toHaveBeenCalled()
    mocks.embed.mockRejectedValue(new Error('sensitive data'))
    const response = await GET(new Request('https://app.example/embed?origin=https://business.example'), context)
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('sensitive')
  })
})
