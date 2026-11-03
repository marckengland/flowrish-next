import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ access: vi.fn(), organization: vi.fn(), profile: vi.fn(), document: vi.fn() }))
vi.mock('@/server/services/callback-access', () => ({ callbackAccess: mocks.access }))
vi.mock('@/server/db/client', () => {
  const db = { organization: { findUniqueOrThrow: mocks.organization }, receptionistConfig: { findUnique: mocks.profile }, knowledgeDocument: { findFirst: mocks.document, fields: { publishedRevision: 'published-revision-reference' } } }
  return { prisma: { ...db, $transaction: vi.fn(async (fn: (value: typeof db) => unknown) => fn(db)) } }
})
import { getReceptionistDemoBusiness } from '../receptionist-demo'
const callbackHours = { timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5], version: '2026-01-01T00:00:00.000Z' }

describe('read-only organization demo information', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.access.mockResolvedValue({ admin: true, crm: false }); mocks.organization.mockResolvedValue({ name: 'Flowrish' })
    mocks.profile.mockResolvedValue({ settings: { enabled: false, businessName: 'Flowrish', knowledge: 'PRIVATE PHONE NOTES', mode: 'always', timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5], forwardTo: '', assigneeId: '', stageId: '' }, updatedAt: new Date(callbackHours.version) })
    mocks.document.mockImplementation(async ({ where }: any) => ({ publishedText: where.publishedCategory === 'SERVICES' ? 'Approved sales CRM services.' : 'Our team will confirm pricing.' }))
  })
  it.each([{ admin: true, crm: false }, { admin: false, crm: true }])('returns only safe demo fields for current access %j', async access => {
    mocks.access.mockResolvedValue(access)
    const business = await getReceptionistDemoBusiness('org-a', 'user-a')
    expect(mocks.access).toHaveBeenCalledWith('org-a', 'user-a')
    expect(Object.keys(business).sort()).toEqual(['callbackHours', 'hours', 'name', 'pricing', 'services'])
    expect(business).toEqual({ name: 'Flowrish', hours: 'Mon, Tue, Wed, Thu, Fri, 9:00 AM to 5:00 PM (Asia/Manila)', services: 'Approved sales CRM services.', pricing: 'Our team will confirm pricing.', callbackHours })
    expect(JSON.stringify(business)).not.toContain('PRIVATE PHONE NOTES')
  })
  it('rejects missing membership and unrelated/foreign permissions before reading business information', async () => {
    for (const denied of [false, true]) {
      if (denied) mocks.access.mockRejectedValue(new Error('Removed membership'))
      else mocks.access.mockResolvedValue({ admin: false, crm: false })
      await expect(getReceptionistDemoBusiness('org-a', 'user-a')).rejects.toThrow()
    }
    expect(mocks.organization).not.toHaveBeenCalled(); expect(mocks.document).not.toHaveBeenCalled()
  })
  it('queries only scoped, current, published and approved service/pricing text', async () => {
    await getReceptionistDemoBusiness('org-a', 'user-a')
    expect(mocks.organization).toHaveBeenCalledWith({ where: { id: 'org-a' }, select: { name: true } })
    expect(mocks.document).toHaveBeenCalledTimes(2)
    for (const [query] of mocks.document.mock.calls) {
      expect(query.where).toMatchObject({ organizationId: 'org-a', archivedAt: null, publishedAt: { not: null }, publishedText: { not: null }, publishedRevision: { not: null }, receptionistApprovedRevision: { equals: 'published-revision-reference' } })
      expect(['SERVICES', 'PRICING']).toContain(query.where.publishedCategory)
      expect(query.select).toEqual({ publishedText: true })
    }
  })
  it('bounds approved text, keeps HTML literal, and falls back without a profile or document', async () => {
    mocks.profile.mockResolvedValue(null); mocks.document.mockResolvedValue({ publishedText: '<img src=x onerror=alert(1)>' + 'x'.repeat(10000) })
    const bounded = await getReceptionistDemoBusiness('org-a', 'user-a')
    expect(bounded.hours).toBe(null); expect(bounded.services?.length).toBeLessThanOrEqual(1200); expect(bounded.services).toContain('<img')
    mocks.document.mockResolvedValue(null)
    expect(await getReceptionistDemoBusiness('org-a', 'user-a')).toEqual({ name: 'Flowrish', hours: null, services: null, pricing: null })
  })
})
