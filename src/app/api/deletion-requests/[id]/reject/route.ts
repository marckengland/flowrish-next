import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { rejectRequest } from '@/server/services/deletion'
import { errorResponse } from '@/lib/errors'
import { z } from 'zod'

const paramsSchema = z.object({
  id: z.string().uuid('Invalid deletion request ID'),
})

/**
 * PATCH /api/deletion-requests/[id]/reject — Reject a pending deletion request.
 *
 * Marks the request as "rejected" without executing any deletion.
 *
 * Requires settings:manage permission (MANAGER/ADMIN/OWNER).
 *
 * Validates: Requirement 33.4
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'admin:settings')

    const { id } = paramsSchema.parse(await params)

    const rejected = await rejectRequest(
      id,
      session.dbUser.id,
      session.organizationId,
    )

    return NextResponse.json({ data: rejected })
  } catch (error) {
    return errorResponse(error)
  }
}
