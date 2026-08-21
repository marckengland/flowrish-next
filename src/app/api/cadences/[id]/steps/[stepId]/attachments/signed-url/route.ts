import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { createCadenceStepAttachmentUploadUrl } from '@/server/services/cadences'
import { safeFileName } from '@/lib/validators/common'
import { errorResponse } from '@/lib/errors'

const paramsSchema = z.object({
  id: z.string().uuid('Invalid cadence ID'),
  stepId: z.string().uuid('Invalid step ID'),
})

const bodySchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().int().positive(),
})

/**
 * POST /api/cadences/[id]/steps/[stepId]/attachments/signed-url
 *
 * Issues a signed upload URL so the browser can send the file bytes
 * directly to Supabase Storage. This avoids routing multi-MB files
 * through the serverless function, which caps request bodies well below
 * the app's 25 MB limit and returned HTTP 413. The JSON body here is tiny
 * (just file metadata), so it never trips that cap.
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

    const data = await createCadenceStepAttachmentUploadUrl(
      id,
      stepId,
      { fileName, mimeType: body.mimeType, size: body.size },
      session.organizationId,
    )

    return NextResponse.json({ data })
  } catch (error) {
    return errorResponse(error)
  }
}
