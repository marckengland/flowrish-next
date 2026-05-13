import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { getLeadAccessFilter } from '@/server/services/access'
import { createLead, getLeads } from '@/server/services/leads'
import { paginationSchema } from '@/lib/validators/common'
import { errorResponse } from '@/lib/errors'

/**
 * GET /api/leads — List leads with pagination and RBAC filtering.
 *
 * Query params: page, pageSize, stageId, assignedUserId, leadStatus, tier
 *
 * Validates: Requirements 4.1, 4.4
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:read')

    const { searchParams } = request.nextUrl

    // Parse pagination
    const pagination = paginationSchema.parse({
      page: searchParams.get('page') ?? undefined,
      pageSize: searchParams.get('pageSize') ?? undefined,
    })

    // Parse optional filters
    const filters = {
      stageId: searchParams.get('stageId') ?? undefined,
      assignedUserId: searchParams.get('assignedUserId') ?? undefined,
      leadStatus: searchParams.get('leadStatus') ?? undefined,
      tier: searchParams.get('tier') ?? undefined,
      search: searchParams.get('search') ?? undefined,
    }

    // Get RBAC-scoped access filter
    const accessFilter = await getLeadAccessFilter(session.dbUser, session.organizationId)

    const result = await getLeads(filters, pagination, accessFilter, session.organizationId)

    return NextResponse.json({
      data: result.leads,
      pagination: result.pagination,
    })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * POST /api/leads — Create a new lead.
 *
 * Body: { firstName, lastName, stageId, ...optional fields }
 *
 * Validates: Requirements 4.1, 4.6
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:write')

    const body = await request.json()
    const lead = await createLead(body, session.dbUser.id, session.organizationId)

    return NextResponse.json({ data: lead }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
