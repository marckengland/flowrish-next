import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import {
  listCadenceStepAttachments,
  uploadCadenceStepAttachment,
} from '@/server/services/cadences'
import { safeFileName } from '@/lib/validators/common'
import { errorResponse, AppError } from '@/lib/errors'

const paramsSchema = z.object({
  id: z.string().uuid('Invalid cadence ID'),
  stepId: z.string().uuid('Invalid step ID'),
})

/**
 * GET /api/cadences/[id]/steps/[stepId]/attachments — list the
 * template-level attachments associated with a cadence step. The runner
 * pulls these and bundles them into every outgoing email when the step
 * fires.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'cadences:read')

    const { id, stepId } = paramsSchema.parse(await params)

    const data = await listCadenceStepAttachments(
      id,
      stepId,
      session.organizationId,
    )

    return NextResponse.json({ data })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * POST /api/cadences/[id]/steps/[stepId]/attachments — upload one or
 * more files as template-level attachments on a cadence step. Accepts
 * `multipart/form-data` with a `file` field.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'cadences:manage')

    const { id, stepId } = paramsSchema.parse(await params)

    const formData = await request.formData()
    const file = formData.get('file')

    if (!(file instanceof File)) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Expected a "file" field in the multipart payload',
        400,
      )
    }

    // Validate the filename before it's used to build a storage path.
    // This is the real path-traversal boundary (see safeFileName).
    const fileName = safeFileName.parse(file.name)

    const buffer = Buffer.from(await file.arrayBuffer())

    const attachment = await uploadCadenceStepAttachment(
      id,
      stepId,
      {
        data: buffer,
        fileName,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
      },
      session.dbUser.id,
      session.organizationId,
    )

    return NextResponse.json({ data: attachment })
  } catch (error) {
    return errorResponse(error)
  }
}
