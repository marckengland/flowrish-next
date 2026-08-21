import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    company: { findFirst: vi.fn(), create: vi.fn() },
  },
}))
vi.mock('@/server/db/client', () => ({ prisma: mockPrisma }))

const { mockCreateInsight } = vi.hoisted(() => ({ mockCreateInsight: vi.fn() }))
vi.mock('@/server/services/insights', () => ({ createInsight: mockCreateInsight }))

import { importBusinesses } from '@/server/services/lead-discovery'

function biz(name: string) {
  return {
    osmType: 'node',
    osmId: 1,
    name,
    category: 'shop: cafe',
    address: '10 Main St',
    phone: null,
    website: 'https://x.example',
    lat: null,
    lon: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('importBusinesses', () => {
  it('creates a company + leadgen insight for new businesses and skips existing ones', async () => {
    mockPrisma.company.findFirst.mockImplementation(
      ({ where }: { where: { name: string } }) =>
        where.name === 'Existing' ? { id: 'c-exist' } : null,
    )
    mockPrisma.company.create.mockResolvedValue({ id: 'c-new' })

    const result = await importBusinesses(
      [biz('New Co'), biz('Existing')],
      'user-1',
      'org-1',
    )

    expect(result).toMatchObject({ created: 1, skipped: 1 })
    expect(result.companyIds).toEqual(['c-new'])
    expect(mockPrisma.company.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'New Co',
        industry: 'shop: cafe',
        website: 'https://x.example',
        organizationId: 'org-1',
      }),
    })
    expect(mockCreateInsight).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'COMPANY',
        entityId: 'c-new',
        kind: 'leadgen',
        source: 'osm',
      }),
      'user-1',
      'org-1',
    )
    expect(mockCreateInsight).toHaveBeenCalledTimes(1)
  })

  it('throws on an empty list', async () => {
    await expect(importBusinesses([], 'u', 'o')).rejects.toMatchObject({
      statusCode: 400,
    })
  })
})
