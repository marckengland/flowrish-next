import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { sendTestEmail, type EmailAttachment } from '@/server/services/email'
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
} from '@/server/services/files'
import { AppError, errorResponse } from '@/lib/errors'

const testEmailJsonSchema = z.object({
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Body is required'),
})

/**
 * POST /api/email/test — Sends a one-off test email to the connected
 * Gmail account itself so the user can preview the rendered output
 * (formatting, personalization-tag substitution, base styling) before
 * activating a cadence or hitting send for real.
 *
 * Accepts either:
 *   - `application/json` with `{ subject, body }`
 *   - `multipart/form-data` with `subject`, `body`, and zero or more
 *     `attachments` files (same upload constraints as the real send
 *     endpoint).
 *
 * Auth: Requires an authenticated session and `leads:write` (the same
 * permission the real send endpoint checks — test sending is part of
 * the outreach surface, gated identically).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:write')

    const contentType = request.headers.get('content-type') ?? ''
    const isMultipart = contentType.toLowerCase().includes('multipart/form-data')

    let subject: string
    let body: string
    let attachments: EmailAttachment[] = []

    if (isMultipart) {
      const formData = await request.formData()
      const rawPayload = {
        subject: formData.get('subject'),
        body: formData.get('body'),
      }
      const parsed = testEmailJsonSchema.parse(rawPayload)
      subject = parsed.subject
      body = parsed.body

      const files = formData.getAll('attachments').filter(
        (f): f is File => typeof f === 'object' && f !== null && 'arrayBuffer' in f,
      )
      attachments = await Promise.all(
        files.map(async (file) => {
          if (file.size > MAX_FILE_SIZE_BYTES) {
            throw new AppError(
              'FILE_TOO_LARGE',
              `${file.name} exceeds the per-file size limit`,
              400,
            )
          }
          if (!ALLOWED_MIME_TYPES.has(file.type)) {
            throw new AppError(
              'UNSUPPORTED_FILE_TYPE',
              `${file.name} is not an allowed file type`,
              400,
            )
          }
          return {
            fileName: file.name,
            mimeType: file.type,
            data: await file.arrayBuffer(),
          }
        }),
      )
    } else {
      const json = await request.json().catch(() => null)
      if (json === null) {
        throw new AppError('INVALID_REQUEST', 'Body must be valid JSON', 400)
      }
      const parsed = testEmailJsonSchema.parse(json)
      subject = parsed.subject
      body = parsed.body
    }

    const result = await sendTestEmail(
      subject,
      body,
      session.dbUser.id,
      session.organizationId,
      attachments,
    )

    return NextResponse.json({ data: result })
  } catch (err) {
    return errorResponse(err)
  }
}
