import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
const mocks = vi.hoisted(() => ({ member: vi.fn(), permissions: vi.fn(), query: vi.fn(), transaction: vi.fn(), review: vi.fn(), faq: vi.fn() }))
vi.mock('@/server/db/client', () => ({ prisma: { organizationMember: { findUnique: mocks.member }, $queryRaw: mocks.query, $transaction: mocks.transaction } }))
vi.mock('@/server/auth/permissions', () => ({ getEffectivePermissions: mocks.permissions }))
vi.mock('@/server/services/rehearsal-faq', () => ({ createRehearsalFaqInTransaction: mocks.faq }))
import { getKnowledgeGapList, getKnowledgeGapDetail, reviewKnowledgeGap, createKnowledgeGapFaq } from '../knowledge-gaps'
const key = 'a'.repeat(64), version = 'b'.repeat(64)
const row = { key, version, question: 'What are your hours?', occurrenceCount: 2, latestAt: new Date('2026-11-03T00:00:00Z'), status: 'open', changedSinceResolution: false, sourceFingerprint: 'c'.repeat(64), draft: 0, published: 0, approved: 0, archived: 0, reviewNotes: null, resolvedAt: null, reviewUpdatedAt: null }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.member.mockResolvedValue({ id: 'member' })
  mocks.permissions.mockResolvedValue(new Set(['admin:settings']))
  mocks.query.mockResolvedValue([row])
  mocks.transaction.mockImplementation(async callback => callback({ $queryRaw: mocks.query, knowledgeGapReview: { upsert: mocks.review } }))
})
describe('organization knowledge gaps service', () => {
  it('requires current membership and effective settings access before querying saved data', async () => {
    mocks.member.mockResolvedValue(null)
    await expect(getKnowledgeGapList('org', 'user', {})).rejects.toMatchObject({ statusCode: 403 })
    mocks.member.mockResolvedValue({ id: 'member' }); mocks.permissions.mockResolvedValue(new Set())
    await expect(createKnowledgeGapFaq('org', 'user', key, { expectedVersion: version })).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it('returns bounded group metadata and parameterizes tenant and pagination', async () => {
    const data = await getKnowledgeGapList('org', 'user', { page: '2', status: 'all' })
    expect(data).toEqual({ groups: [{ key, version, question: row.question, occurrenceCount: 2, latestAt: row.latestAt.toISOString(), status: 'open', changedSinceResolution: false, faqCounts: { draft: 0, published: 0, approved: 0, archived: 0 }, resolution: null }], page: 2, pageSize: 20, hasMore: false })
    const [strings, ...values] = mocks.query.mock.calls[0]
    const query = Prisma.sql(strings, ...values)
    expect(query.values).toContain('org'); expect(query.values).toContain(21); expect(query.values).toContain(20)
    expect(JSON.stringify(data)).not.toContain('sourceFingerprint')
    expect(JSON.stringify(data)).not.toContain('snapshot')
  })
  it('rejects unknown query fields and invalid pagination before scanning reports', async () => {
    await expect(getKnowledgeGapList('org', 'user', { page: 'no', organizationId: 'other' })).rejects.toBeDefined()
    expect(mocks.query).not.toHaveBeenCalled()
  })
  it('uses indistinguishable not-found errors for absent or foreign-tenant groups', async () => {
    mocks.query.mockResolvedValue([])
    await expect(getKnowledgeGapDetail('other', 'user', key, {})).rejects.toMatchObject({ code: 'KNOWLEDGE_GAP_NOT_FOUND', statusCode: 404 })
    const [strings, ...values] = mocks.query.mock.calls[0]
    const query = Prisma.sql(strings, ...values)
    expect(query.values).toContain('other')
    expect(query.values).toContain(key)
  })
  it('requires retest confirmation and rejects stale review tokens without writing a resolution', async () => {
    await expect(reviewKnowledgeGap('org', 'user', key, { expectedVersion: version, action: 'resolve', retested: false, notes: '' })).rejects.toBeDefined()
    await expect(reviewKnowledgeGap('org', 'user', key, { expectedVersion: 'd'.repeat(64), action: 'resolve', retested: true, notes: '' })).rejects.toMatchObject({ statusCode: 409 })
    expect(mocks.review).not.toHaveBeenCalled()
    expect(mocks.faq).not.toHaveBeenCalled()
  })
  it('sanitizes database failures', async () => {
    mocks.query.mockRejectedValue(new Error('private SQL and credentials'))
    await expect(getKnowledgeGapList('org', 'user', {})).rejects.toMatchObject({ code: 'KNOWLEDGE_GAPS_UNAVAILABLE', statusCode: 503, message: 'Knowledge gaps are unavailable. Please try again.' })
  })
})
