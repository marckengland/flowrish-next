import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { prepareFollowUpSend, prepareFollowUpTemplateSend } from '@/server/services/follow-up-drafts'
import { sendEmail, type EmailAttachment } from '@/server/services/email'
import { assertFollowUpContext, assertFollowUpOrigin } from '@/server/services/follow-up-http'
import { requireFollowUpWrites } from '@/server/services/follow-up-access'
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
} from '@/server/services/files'
import { AppError, errorResponse } from '@/lib/errors'

export const maxDuration = 120

const sendEmailBodySchema = z.object({
  leadId: z.string().uuid('Invalid lead ID'),
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Body is required'),
  /**
   * When provided, the email is sent as a reply on an existing Gmail
   * thread. The Gmail API requires the threadId on the send payload to
   * stitch the message into the conversation (Requirement 7.3).
   */
  threadId: z.string().min(1).optional(),
  followUpId: z.string().uuid().optional(),
  draftVersion: z.string().uuid().optional(),
}).refine((value) => !value.draftVersion || Boolean(value.followUpId), { message: 'A generated draft requires its follow-up ID.' })

/**
 * POST /api/email/send — Send an email to a lead with personalization tag replacement.
 *
 * Accepts two content types:
 *
 * - `application/json` — `{ leadId, subject, body, threadId? }`
 *   The simple path used when the rep doesn't attach files.
 *
 * - `multipart/form-data` — fields:
 *   - `payload`: JSON-encoded `{ leadId, subject, body, threadId? }`
 *   - `attachments`: zero or more `File` entries
 *   Used when files are attached so they can ride inside the Gmail
 *   message itself rather than being uploaded separately to the lead.
 *   File size and MIME type are validated against the same allowlist
 *   as `/api/upload` (Requirement 7.6, 13.1, 13.4).
 *
 * Validates: Requirements 7.2, 7.3, 7.6
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:read')
    requirePermission(session.dbUser, 'leads:write')
    assertFollowUpContext(request, session)
    assertFollowUpOrigin(request)
    requireFollowUpWrites()

    const contentType = request.headers.get('content-type') ?? ''
    const isMultipart = contentType.toLowerCase().includes('multipart/form-data')

    let parsedPayload: z.infer<typeof sendEmailBodySchema>
    let attachments: EmailAttachment[] = []

    if (isMultipart) {
      let formData: FormData
      try {
        formData = await request.formData()
      } catch {
        throw new AppError(
          'INVALID_REQUEST',
          'Expected multipart/form-data request body',
          400,
        )
      }

      const payloadEntry = formData.get('payload')
      if (typeof payloadEntry !== 'string') {
        throw new AppError('INVALID_REQUEST', 'Missing payload field', 400)
      }
      let rawPayload: unknown
      try {
        rawPayload = JSON.parse(payloadEntry)
      } catch {
        throw new AppError('INVALID_REQUEST', 'payload must be valid JSON', 400)
      }
      parsedPayload = sendEmailBodySchema.parse(rawPayload)

      // Read attachments. We deliberately bound the per-file size and
      // total size — Gmail rejects requests over 35 MB raw and the
      // platform allowlist already restricts file types.
      const fileEntries = formData
        .getAll('attachments')
        .filter((entry): entry is File => entry instanceof File)

      let totalSize = 0
      for (const file of fileEntries) {
        if (file.size <= 0) {
          throw new AppError('FILE_EMPTY', `${file.name} is empty`, 400)
        }
        if (file.size > MAX_FILE_SIZE_BYTES) {
          throw new AppError(
            'FILE_TOO_LARGE',
            `${file.name} exceeds the per-file maximum of 25 MB`,
            400,
          )
        }
        if (!ALLOWED_MIME_TYPES.has(file.type)) {
          throw new AppError(
            'UNSUPPORTED_FILE_TYPE',
            `${file.name}: MIME type "${file.type}" is not allowed`,
            400,
          )
        }
        totalSize += file.size
        // Gmail's hard send-payload cap is ~35 MB; we use a slightly
        // lower threshold because of base64 inflation (~4/3) plus
        // multipart envelope overhead.
        if (totalSize > 25 * 1024 * 1024) {
          throw new AppError(
            'ATTACHMENTS_TOO_LARGE',
            'Combined attachment size exceeds 25 MB',
            400,
          )
        }
      }

      const collected: EmailAttachment[] = []
      for (const file of fileEntries) {
        const buffer = await file.arrayBuffer()
        collected.push({
          fileName: file.name,
          mimeType: file.type,
          data: buffer,
        })
      }
      attachments = collected
    } else {
      const body = await request.json()
      parsedPayload = sendEmailBodySchema.parse(body)
    }

    let prepared: Awaited<ReturnType<typeof prepareFollowUpSend>> | undefined
    if (parsedPayload.followUpId && parsedPayload.draftVersion) {
      requirePermission(session.dbUser, 'leads:read')
      prepared = await prepareFollowUpSend(session.organizationId, session.dbUser.id, parsedPayload.followUpId, parsedPayload.draftVersion, parsedPayload.leadId)
      if (parsedPayload.subject !== prepared.subject) throw new AppError('DRAFT_CONFLICT', 'The reply must keep its verified conversation subject.', 409)
      if (parsedPayload.threadId && parsedPayload.threadId !== prepared.threadId) throw new AppError('DRAFT_CONFLICT', 'The reply must use its source conversation.', 409)
    }
    let template: Awaited<ReturnType<typeof prepareFollowUpTemplateSend>> | undefined
    if (parsedPayload.followUpId && !parsedPayload.draftVersion) {
      if (parsedPayload.threadId) throw new AppError('INVALID_SOURCE', 'A template starts a new email. Refresh before changing its source.', 409)
      template = await prepareFollowUpTemplateSend(session.organizationId, session.dbUser.id, parsedPayload.followUpId, parsedPayload.leadId)
    }
    const result = await sendEmail(parsedPayload.leadId, parsedPayload.subject, parsedPayload.body, session.dbUser.id, session.organizationId, prepared?.threadId ?? parsedPayload.threadId, attachments, { ...(prepared?.options ?? template?.options ?? {}), manualActor: true })

    return NextResponse.json({ data: result, scope: { organizationId: session.organizationId, userId: session.dbUser.id }, capabilities: { canWrite: true } }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    const safe = error instanceof z.ZodError ? error : error instanceof AppError && error.statusCode < 500 ? error : new AppError('EMAIL_SEND_UNAVAILABLE', 'The send result could not be confirmed. Check the mailbox before retrying.', 503)
    const response = errorResponse(safe); response.headers.set('Cache-Control', 'private, no-store'); return response
  }
}
