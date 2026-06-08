import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { deleteCadenceStepAttachment } from '@/server/services/cadences'
import { errorResponse } from '@/lib/errors'

const paramsSchema = z.object({
  id: z.string().uuid('Invalid cadence ID'),
  stepId: z.string().uuid('Invalid step ID'),
  attachmentId: z.string().uuid('Invalid attachment ID'),
})

/**
 * DELETE /api/cadences/[id]/steps/[stepId]/attachments/[attachmentId]
 * — remove a template-level attachment from a cadence step. Both the
 * Supabase Storage object and the DB row are removed. Storage cleanup
 * is best-effort.
 */
export async function DELETE(
  _request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string; stepId: string; attachmentId: string }>
  },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'cadences:manage')

    const { id, stepId, attachmentId } = paramsSchema.parse(await params)

    await deleteCadenceStepAttachment(
      id,
      stepId,
      attachmentId,
      session.organizationId,
    )

    return NextResponse.json({ data: { deleted: true } })
  } catch (error) {
    return errorResponse(error)
  }
}
