import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { createInsight, listInsights } from '@/server/services/insights'
import { errorResponse } from '@/lib/errors'

const entityTypeEnum = z.enum(['LEAD', 'COMPANY', 'CONTACT'])

const createSchema = z.object({
  entityType: entityTypeEnum,
  entityId: z.string().min(1),
  kind: z.enum(['research', 'background', 'leadgen']).optional(),
  summary: z.string().max(2000).optional().nullable(),
  data: z.unknown(),
  sources: z.array(z.string()).max(50).optional(),
  source: z.string().max(40).optional(),
})

/**
 * GET /api/insights?entityType=COMPANY&entityId=<uuid> — list saved insights
 * for a record (newest first).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:read')

    const { searchParams } = request.nextUrl
    const entityType = entityTypeEnum.parse(searchParams.get('entityType'))
    const entityId = z.string().min(1).parse(searchParams.get('entityId'))

    const data = await listInsights(entityType, entityId, session.organizationId)
    return NextResponse.json({ data })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * POST /api/insights — save an insight (e.g. account research) onto a
 * Lead / Company / Contact for later reference.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:write')

    const body = await request.json()
    const input = createSchema.parse(body)

    const insight = await createInsight(
      input,
      session.dbUser.id,
      session.organizationId,
    )
    return NextResponse.json({ data: insight }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
