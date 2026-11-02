import { describe, expect, it } from 'vitest'
import { websiteOriginSchema, websiteReceptionistSaveSchema, websiteMessageInputSchema, websiteCallbackInputSchema } from './website-receptionist'
describe('organization website receptionist boundaries', () => {
  it('normalizes exact HTTPS website origins and rejects wildcard or credential URLs', () => {
    expect(websiteOriginSchema.parse('https://example.invalid/')).toBe('https://example.invalid')
    for (const origin of ['http://example.invalid', 'https://*.example.invalid', 'https://%2A.example.invalid', 'https://user:pass@example.invalid', 'https://example.invalid/path', 'https://example.invalid?x=1', 'https://example.invalid/#hash', 'null']) expect(websiteOriginSchema.safeParse(origin).success).toBe(false)
  })
  it('requires an explicit spending acknowledgement and allowed website before enabling', () => {
    const input = { enabled: false, allowedOrigins: [], dailyMessageLimit: 5, dailyTokenLimit: 20000, dailyCallbackLimit: 10, expectedUpdatedAt: null, acknowledged: false }
    expect(websiteReceptionistSaveSchema.parse(input)).toEqual(input)
    expect(websiteReceptionistSaveSchema.safeParse({ ...input, enabled: true }).success).toBe(false)
    expect(websiteReceptionistSaveSchema.safeParse({ ...input, enabled: true, allowedOrigins: ['https://example.invalid'], acknowledged: true }).success).toBe(true)
    expect(websiteReceptionistSaveSchema.safeParse({ ...input, organizationId: 'other' }).success).toBe(false)
  })
  it('bounds untrusted user history and requires confirmed callback details with an empty honeypot', () => {
    const message = { requestId: '11111111-1111-4111-8111-111111111111', expectedTurn: 0, question: 'What are your hours?', history: [], website: '' }
    expect(websiteMessageInputSchema.safeParse(message).success).toBe(true)
    expect(websiteMessageInputSchema.safeParse({ ...message, history: Array(5).fill('old') }).success).toBe(false)
    expect(websiteMessageInputSchema.safeParse({ ...message, website: 'bot.invalid' }).success).toBe(false)
    expect(websiteMessageInputSchema.safeParse({ ...message, state: { role: 'system' } }).success).toBe(false)
    const callback = { fullName: 'Jamie Example', phone: '+12025550123', reason: 'A service inquiry', confirmed: true, website: '' }
    expect(websiteCallbackInputSchema.safeParse(callback).success).toBe(true)
    expect(websiteCallbackInputSchema.safeParse({ ...callback, confirmed: false }).success).toBe(false)
    expect(websiteCallbackInputSchema.safeParse({ ...callback, phone: '123' }).success).toBe(false)
  })
})
