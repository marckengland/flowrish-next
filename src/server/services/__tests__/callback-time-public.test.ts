import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ raw: vi.fn(), session: vi.fn(), sessionCreate: vi.fn(), sessionUpdate: vi.fn(), business: vi.fn(), create: vi.fn(), usage: vi.fn(), count: vi.fn() }))
vi.mock('@/server/db/client', () => {
  const db = { $queryRaw: mocks.raw, websiteReceptionistSession: { findUnique: mocks.session, create: mocks.sessionCreate, update: mocks.sessionUpdate }, receptionistConfig: { findUnique: mocks.business }, websiteReceptionistCallback: { create: mocks.create }, websiteReceptionistUsage: { upsert: mocks.usage, update: mocks.count }, aiProviderConfig: { findUnique: vi.fn(async () => null) }, knowledgeDocument: { count: vi.fn(async () => 0), fields: { publishedRevision: 'published' } } }
  return { prisma: { ...db, $transaction: vi.fn(async (fn: (value: typeof db) => unknown) => fn(db)) } }
})
vi.mock('../website-receptionist-generation', () => ({ generateWebsiteReceptionistAnswer: vi.fn(() => { throw Error('Live generation forbidden') }) }))
import { startWebsiteSession, submitWebsiteCallback } from '../website-receptionist'

const id = '11111111-1111-4111-8111-111111111111', organizationId = '22222222-2222-4222-8222-222222222222'
const token = 'b'.repeat(64), now = new Date('2030-01-01T12:00:00Z'), version = '2026-01-01T00:00:00.000Z'
const calendar = { timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5], version }
const body = { fullName: 'Sample Visitor', phone: '+12025550123', reason: 'Ask about services', confirmed: true, website: '', preferredTime: { localTime: '2030-01-07T09:30', timeZone: calendar.timeZone, businessVersion: version } }
const context = { ip: '192.0.2.1', origin: 'https://app.example.test' }

describe('timed public callbacks without model transport', () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now); vi.stubEnv('EMAIL_ENCRYPTION_KEY', 'ab'.repeat(32))
    const config = { publicId: id, organizationId, enabled: true, allowedOrigins: ['https://example.test'], updatedAt: new Date(version), dailyCallbackLimit: 5 }
    mocks.raw.mockImplementation(async (strings: TemplateStringsArray) => strings.join('').includes('WebsiteReceptionistConfig') ? [config] : [{ id: organizationId }])
    mocks.business.mockResolvedValue({ settings: { businessName: 'Sample Business', enabled: false, knowledge: 'PRIVATE PHONE NOTES', mode: 'always', ...calendar, forwardTo: '', assigneeId: '', stageId: '' }, updatedAt: new Date(version) })
    const hash = createHmac('sha256', Buffer.from('ab'.repeat(32), 'hex')).update(`${organizationId}\n2030-01-01T00:00:00.000Z\n${context.ip}`).digest('hex')
    const current = { id: 'session', organizationId, ipHash: hash, createdAt: new Date(now.getTime() - 3000), expiresAt: new Date(now.getTime() + 1800000), configVersion: config.updatedAt, siteOrigin: 'https://example.test', callbackSubmittedAt: null, callbackRequestHash: null }
    mocks.session.mockImplementation(async () => current)
    mocks.sessionUpdate.mockImplementation(async ({ data }: any) => { Object.assign(current, data); return current })
    mocks.usage.mockResolvedValue({ sessions: 0, messages: 0, callbacks: 0, reservedTokens: 0 })
    mocks.create.mockResolvedValue({ id: 'saved' })
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })
  it('returns public calendar metadata while excluding private settings', async () => {
    const result = await startWebsiteSession(id, { siteOrigin: 'https://example.test', website: '' }, context)
    expect(result.callbackHours).toEqual(calendar); expect(JSON.stringify(result)).not.toContain('PRIVATE PHONE NOTES')
  })
  it('persists canonical UTC/timezone/readback and a retry hash only after validation', async () => {
    expect(await submitWebsiteCallback(id, token, body, context)).toEqual({ received: true })
    expect(mocks.create.mock.calls[0][0].data.preferredTime).toEqual({ ...body.preferredTime, at: '2030-01-07T01:30:00.000Z' })
    expect(mocks.sessionUpdate.mock.calls[0][0].data.callbackRequestHash).toMatch(/^[a-f0-9]{64}$/)
  })
  it.each([{ localTime: '2030-01-07T17:00' }, { timeZone: 'UTC' }, { businessVersion: '2026-01-02T00:00:00.000Z' }])('rejects invalid or stale timing before quota consumption: %j', async change => {
    await expect(submitWebsiteCallback(id, token, { ...body, preferredTime: { ...body.preferredTime, ...change } }, context)).rejects.toMatchObject({ statusCode: change.localTime ? 400 : 409 })
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.usage).not.toHaveBeenCalled()
  })
  it('retries the same timed payload without recreating a deleted source or consuming more quota', async () => {
    await submitWebsiteCallback(id, token, body, context); mocks.create.mockClear(); mocks.usage.mockClear()
    expect(await submitWebsiteCallback(id, token, body, context)).toEqual({ received: true })
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.usage).not.toHaveBeenCalled()
    await expect(submitWebsiteCallback(id, token, { ...body, preferredTime: { ...body.preferredTime, localTime: '2030-01-07T10:30' } }, context)).rejects.toMatchObject({ statusCode: 409 })
  })
})
