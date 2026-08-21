import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { finalizeCadenceStepAttachment } from '@/server/services/cadences'
import { safeFileName } from '@/lib/validators/common'
import { errorResponse } from '@/lib/errors'

const paramsSchema = z.object({
  id: z.string().uuid('Invalid cadence ID'),
  stepId: z.string().uuid('Invalid step ID'),
})

const bodySchema = z.object({
  attachmentId: z.string().uuid(),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().int().positive(),
})

/**
 * POST /api/cadences/[id]/steps/[stepId]/attachments/finalize
 *
 * Records the DB row for a file the browser already uploaded to Supabase
 * Storage via a signed URL (see the sibling signed-url route). Verifies
 * the object actually landed before inserting.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'cadences:manage')

    const { id, stepId } = paramsSchema.parse(await params)
    const body = bodySchema.parse(await request.json())
    const fileName = safeFileName.parse(body.fileName)

    const data = await finalizeCadenceStepAttachment(
      id,
      stepId,
      {
        attachmentId: body.attachmentId,
        fileName,
        mimeType: body.mimeType,
        size: body.size,
      },
      session.dbUser.id,
      session.organizationId,
    )

    return NextResponse.json({ data })
  } catch (error) {
    return errorResponse(error)
  }
}
