import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    insight: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
  },
}))
vi.mock('@/server/db/client', () => ({ prisma: mockPrisma }))

import {
  createInsight,
  listInsights,
  deleteInsight,
} from '@/server/services/insights'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createInsight', () => {
  it('creates a normalized insight (defaults kind/source/sources)', async () => {
    mockPrisma.insight.create.mockResolvedValue({ id: 'i1' })
    await createInsight(
      { entityType: 'COMPANY', entityId: 'c1', data: { a: 1 } },
      'user-1',
      'org-1',
    )
    expect(mockPrisma.insight.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: 'COMPANY',
        entityId: 'c1',
        kind: 'research',
        source: 'ai',
        sources: [],
        createdById: 'user-1',
        organizationId: 'org-1',
      }),
    })
  })

  it('rejects an invalid entityType', async () => {
    await expect(
      createInsight(
        { entityType: 'DEAL', entityId: 'x', data: {} },
        'u',
        'o',
      ),
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(mockPrisma.insight.create).not.toHaveBeenCalled()
  })

  it('rejects a missing entityId', async () => {
    await expect(
      createInsight({ entityType: 'LEAD', entityId: '  ', data: {} }, 'u', 'o'),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('caps sources at 50 entries', async () => {
    mockPrisma.insight.create.mockResolvedValue({ id: 'i2' })
    const sources = Array.from({ length: 80 }, (_, i) => `https://x/${i}`)
    await createInsight(
      { entityType: 'CONTACT', entityId: 'ct1', data: {}, sources },
      'u',
      'o',
    )
    const arg = mockPrisma.insight.create.mock.calls[0][0].data.sources
    expect(arg).toHaveLength(50)
  })
})

describe('listInsights', () => {
  it('queries by org + entity, newest first', async () => {
    mockPrisma.insight.findMany.mockResolvedValue([])
    await listInsights('COMPANY', 'c1', 'org-1')
    expect(mockPrisma.insight.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', entityType: 'COMPANY', entityId: 'c1' },
      orderBy: { createdAt: 'desc' },
    })
  })

  it('rejects an invalid entityType', async () => {
    await expect(listInsights('NOPE', 'c1', 'org-1')).rejects.toMatchObject({
      statusCode: 400,
    })
  })
})

describe('deleteInsight', () => {
  it('throws NOT_FOUND when the insight is not in the org', async () => {
    mockPrisma.insight.findFirst.mockResolvedValue(null)
    await expect(deleteInsight('i1', 'org-1')).rejects.toMatchObject({
      statusCode: 404,
    })
    expect(mockPrisma.insight.delete).not.toHaveBeenCalled()
  })

  it('deletes when found in the org', async () => {
    mockPrisma.insight.findFirst.mockResolvedValue({ id: 'i1' })
    mockPrisma.insight.delete.mockResolvedValue({ id: 'i1' })
    await deleteInsight('i1', 'org-1')
    expect(mockPrisma.insight.delete).toHaveBeenCalledWith({ where: { id: 'i1' } })
  })
})
