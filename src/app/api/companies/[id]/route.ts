import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { getCompanyById, updateCompany, deleteCompany } from '@/server/services/contacts'
import { errorResponse } from '@/lib/errors'

/**
 * GET /api/companies/[id] — Get a single company by ID.
 *
 * Validates: Requirement 19.3
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'contacts:read')

    const { id } = await params
    const company = await getCompanyById(id, session.organizationId)

    return NextResponse.json({ data: company })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * PATCH /api/companies/[id] — Update a company.
 *
 * Validates: Requirement 19.3
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'contacts:write')

    const { id } = await params
    const body = await request.json()
    const company = await updateCompany(id, body, session.organizationId)

    return NextResponse.json({ data: company })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * DELETE /api/companies/[id] — Delete a company.
 *
 * Validates: Requirement 19.3
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'contacts:write')

    const { id } = await params
    await deleteCompany(id, session.organizationId)

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return errorResponse(error)
  }
}
