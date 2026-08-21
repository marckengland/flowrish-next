import { prisma } from '@/server/db/client'
import { AppError } from '@/lib/errors'
import {
  discoverBusinesses,
  osmUrl,
  type DiscoveredBusiness,
  type DiscoverParams,
} from '@/lib/web/overpass'
import { createInsight } from './insights'

/**
 * Lead discovery — keyless OSM-backed business search + import.
 *
 * `searchBusinesses` is read-only (no DB). `importBusinesses` creates a
 * Company per selected business (de-duped by name within the org) and saves
 * the full discovered record as a `leadgen` Insight for reference.
 */

export async function searchBusinesses(
  params: DiscoverParams,
): Promise<DiscoveredBusiness[]> {
  if (!params.location?.trim()) {
    throw new AppError('VALIDATION_ERROR', 'A location is required', 400)
  }
  return discoverBusinesses({
    ...params,
    limit: Math.min(params.limit ?? 25, 60),
  })
}

export interface ImportResult {
  created: number
  skipped: number
  companyIds: string[]
}

export async function importBusinesses(
  businesses: DiscoveredBusiness[],
  userId: string,
  orgId: string,
): Promise<ImportResult> {
  if (!userId) throw new AppError('VALIDATION_ERROR', 'User ID is required', 400)
  if (!orgId) throw new AppError('VALIDATION_ERROR', 'Organization ID is required', 400)
  if (!Array.isArray(businesses) || businesses.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'No businesses to import', 400)
  }

  let created = 0
  let skipped = 0
  const companyIds: string[] = []

  // Cap per request to protect the DB (free-tier) and stay well-behaved.
  for (const biz of businesses.slice(0, 100)) {
    const name = biz.name?.trim()
    if (!name) {
      skipped += 1
      continue
    }

    // De-dupe by company name within the org so re-imports don't pile up.
    const existing = await prisma.company.findFirst({
      where: { organizationId: orgId, name },
      select: { id: true },
    })
    if (existing) {
      skipped += 1
      continue
    }

    const company = await prisma.company.create({
      data: {
        name,
        industry: biz.category ?? null,
        website: biz.website ?? null,
        organizationId: orgId,
      },
    })

    // Keep the richer OSM data (address, phone, coords, osm id) as a saved
    // leadgen Insight on the new company.
    await createInsight(
      {
        entityType: 'COMPANY',
        entityId: company.id,
        kind: 'leadgen',
        source: 'osm',
        summary:
          [biz.category, biz.address, biz.phone].filter(Boolean).join(' · ') ||
          null,
        data: biz,
        sources: [osmUrl(biz), biz.website].filter(
          (s): s is string => Boolean(s),
        ),
      },
      userId,
      orgId,
    )

    created += 1
    companyIds.push(company.id)
  }

  return { created, skipped, companyIds }
}
