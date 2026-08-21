import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { importBusinesses } from '@/server/services/lead-discovery'
import { errorResponse } from '@/lib/errors'

const businessSchema = z.object({
  osmType: z.string(),
  osmId: z.number(),
  name: z.string().min(1),
  category: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  lat: z.number().nullable().optional(),
  lon: z.number().nullable().optional(),
})

const importSchema = z.object({
  businesses: z.array(businessSchema).min(1).max(100),
})

/**
 * POST /api/lead-discovery/import — import selected discovered businesses as
 * Company records (de-duped) with a saved leadgen Insight on each.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:write')

    const body = await request.json()
    const { businesses } = importSchema.parse(body)

    const result = await importBusinesses(
      businesses.map((b) => ({
        osmType: b.osmType,
        osmId: b.osmId,
        name: b.name,
        category: b.category ?? null,
        address: b.address ?? null,
        phone: b.phone ?? null,
        website: b.website ?? null,
        lat: b.lat ?? null,
        lon: b.lon ?? null,
      })),
      session.dbUser.id,
      session.organizationId,
    )
    return NextResponse.json({ data: result }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
