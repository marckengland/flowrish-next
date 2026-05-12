import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import {
  uploadFile,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
} from '@/server/services/files'
import { AppError, errorResponse } from '@/lib/errors'

/**
 * POST /api/upload — Upload a file attachment for a lead.
 *
 * Request: multipart/form-data
 *   - file: the file to upload (required)
 *   - leadId: the lead to attach the file to (required)
 *
 * Response: { data: { attachmentId, storagePath, activityId } }
 *
 * Access control:
 * - Requires an authenticated session
 * - Requires the `leads:write` permission
 * - The service layer verifies the lead belongs to the caller's organization
 *
 * Validation (mirrored from the service layer for early rejection):
 * - File size must be ≤ 25 MB
 * - MIME type must be in the allowlist (PDF, images, documents, spreadsheets)
 * - File must be non-empty and have a name
 *
 * Validates: Requirements 13.1, 13.4
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:write')

    // Parse multipart form data. Throws if the content type is not multipart
    // or the body is malformed — normalise to a 400 response.
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

    const fileEntry = formData.get('file')
    const leadIdEntry = formData.get('leadId')

    if (!(fileEntry instanceof File)) {
      throw new AppError('INVALID_REQUEST', 'Missing file field', 400)
    }

    if (typeof leadIdEntry !== 'string' || leadIdEntry.trim().length === 0) {
      throw new AppError('INVALID_REQUEST', 'Missing leadId field', 400)
    }

    const leadId = leadIdEntry.trim()

    // Early size check to avoid reading large payloads into memory unnecessarily.
    if (fileEntry.size > MAX_FILE_SIZE_BYTES) {
      throw new AppError(
        'FILE_TOO_LARGE',
        `File exceeds the maximum size of 25 MB (got ${fileEntry.size} bytes)`,
        400,
      )
    }

    if (fileEntry.size <= 0) {
      throw new AppError('FILE_EMPTY', 'File is empty', 400)
    }

    // Early MIME type check. The service also validates, but rejecting here
    // avoids touching storage/DB for obviously invalid uploads.
    if (!ALLOWED_MIME_TYPES.has(fileEntry.type)) {
      throw new AppError(
        'UNSUPPORTED_FILE_TYPE',
        `MIME type "${fileEntry.type}" is not allowed. Allowed: PDF, images, documents, spreadsheets.`,
        400,
      )
    }

    const buffer = await fileEntry.arrayBuffer()

    const result = await uploadFile(
      {
        data: buffer,
        fileName: fileEntry.name,
        mimeType: fileEntry.type,
        size: fileEntry.size,
      },
      leadId,
      session.dbUser.id,
      session.organizationId,
    )

    return NextResponse.json({ data: result }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
