import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { approveRequest } from '@/server/services/deletion'
import { errorResponse } from '@/lib/errors'
import { z } from 'zod'

const paramsSchema = z.object({
  id: z.string().uuid('Invalid deletion request ID'),
})

/**
 * PATCH /api/deletion-requests/[id]/approve — Approve a pending deletion request.
 *
 * Executes the deletion (soft-delete for leads, hard delete for contacts/tasks)
 * and marks the request as "approved".
 *
 * Requires admin:settings permission (MANAGER/ADMIN/OWNER).
 *
 * Validates: Requirements 33.3, 33.4
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'admin:settings')

    const { id } = paramsSchema.parse(await params)

    const approved = await approveRequest(
      id,
      session.dbUser.id,
      session.organizationId,
    )

    return NextResponse.json({ data: approved })
  } catch (error) {
    return errorResponse(error)
  }
}
