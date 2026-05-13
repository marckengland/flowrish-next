import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { getCompanies, createCompany } from '@/server/services/contacts'
import { paginationSchema } from '@/lib/validators/common'
import { errorResponse } from '@/lib/errors'

/**
 * GET /api/companies — List companies with pagination and optional filters.
 *
 * Query params: page, pageSize, search
 *
 * Validates: Requirement 19.3
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'contacts:read')

    const { searchParams } = request.nextUrl

    const pagination = paginationSchema.parse({
      page: searchParams.get('page') ?? undefined,
      pageSize: searchParams.get('pageSize') ?? undefined,
    })

    const filters = {
      search: searchParams.get('search') ?? undefined,
    }

    const result = await getCompanies(filters, pagination, session.organizationId)

    return NextResponse.json({
      data: result.companies,
      pagination: result.pagination,
    })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * POST /api/companies — Create a new company.
 *
 * Body: { name, ...optional fields }
 *
 * Validates: Requirement 19.3
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'contacts:write')

    const body = await request.json()
    const company = await createCompany(body, session.organizationId)

    return NextResponse.json({ data: company }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
