import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { searchBusinesses } from '@/server/services/lead-discovery'
import { errorResponse } from '@/lib/errors'

const searchSchema = z.object({
  location: z.string().min(1, 'A location is required').max(200),
  category: z.string().max(40).optional(),
  keyword: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(60).optional(),
})

/**
 * POST /api/lead-discovery/search — keyless OSM business discovery.
 * Read-only: returns candidate businesses; nothing is written.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:read')

    const body = await request.json()
    const params = searchSchema.parse(body)

    const data = await searchBusinesses(params)
    return NextResponse.json({ data })
  } catch (error) {
    return errorResponse(error)
  }
}
