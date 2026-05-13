import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { requestDeletion, listPendingRequests } from '@/server/services/deletion'
import { errorResponse } from '@/lib/errors'

/**
 * GET /api/deletion-requests — List pending deletion requests.
 *
 * Only accessible to users with settings:manage permission (MANAGER/ADMIN/OWNER).
 * Returns pending requests ordered by createdAt ascending (oldest first).
 *
 * Validates: Requirement 33.6
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'settings:manage')

    const requests = await listPendingRequests(session.organizationId)

    return NextResponse.json({ data: requests })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * POST /api/deletion-requests — Create a new deletion request.
 *
 * Body: { entityType, entityId, entityName, reason? }
 *
 * Any authenticated user can request deletion. Rejects duplicate pending
 * requests for the same entity.
 *
 * Validates: Requirements 33.1, 33.2
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()

    const body = await request.json()
    const deletionRequest = await requestDeletion(
      session.dbUser.id,
      session.organizationId,
      body,
    )

    return NextResponse.json({ data: deletionRequest }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
