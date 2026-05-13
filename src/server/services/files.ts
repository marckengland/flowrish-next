import { createTenantPrisma } from '@/server/db/middleware'
import { createSupabaseAdmin } from '@/lib/supabase/admin'
import { AppError } from '@/lib/errors'
import { getLeadAccessFilter } from '@/server/services/access'
import { getSession } from '@/server/auth/session'

/**
 * Maximum allowed file size (25 MB) per Requirement 13.4.
 */
export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024

/**
 * Short expiration for signed download URLs (5 minutes) per Requirement 13.3.
 */
export const SIGNED_URL_EXPIRATION_SECONDS = 5 * 60

/**
 * Supabase Storage bucket used for all file attachments.
 * RLS policies on this bucket enforce tenant and lead-level isolation
 * at the storage layer. Application code enforces the same rules before
 * generating signed URLs.
 */
export const FILE_ATTACHMENTS_BUCKET = 'attachments'

/**
 * Allowed MIME types for uploads per Requirement 13.4.
 *
 * Covers: PDFs, images, documents, spreadsheets.
 */
export const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  // PDF
  'application/pdf',
  // Images
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  // Documents
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/csv',
  'application/rtf',
  // Spreadsheets
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.spreadsheet',
  // Presentations
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
])

export interface UploadFileInput {
  /** The raw file content. */
  data: ArrayBuffer | Buffer | Uint8Array
  /** Original file name supplied by the client. */
  fileName: string
  /** MIME type reported by the client (validated against the allowlist). */
  mimeType: string
  /** File size in bytes. */
  size: number
}

export interface UploadFileResult {
  attachmentId: string
  storagePath: string
  activityId: string
}

/**
 * Upload a file attachment for a lead.
 *
 * Performs application-level validation, uploads the file to Supabase
 * Storage under a per-organization prefix, and creates a matching
 * FileAttachment record linked to a FILE_ATTACHMENT activity.
 *
 * Flow:
 * 1. Validate size (≤ 25 MB) and MIME type against the allowlist
 * 2. Verify the lead exists within the organization (tenant middleware
 *    enforces org ownership)
 * 3. Create a FILE_ATTACHMENT activity on the lead so the upload appears
 *    in the timeline (FileAttachment requires an activityId per schema)
 * 4. Upload the file to Supabase Storage at
 *    `{orgId}/{leadId}/{attachmentId}-{sanitizedName}`
 * 5. Create the FileAttachment record with the storage path
 *
 * Validates: Requirements 13.1, 13.4
 */
export async function uploadFile(
  file: UploadFileInput,
  leadId: string,
  userId: string,
  orgId: string,
): Promise<UploadFileResult> {
  // 1. Validate file size
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new AppError(
      'FILE_TOO_LARGE',
      `File exceeds the maximum size of 25 MB (got ${file.size} bytes)`,
      400,
    )
  }

  if (file.size <= 0) {
    throw new AppError('FILE_EMPTY', 'File is empty', 400)
  }

  // 2. Validate MIME type against the allowlist
  if (!ALLOWED_MIME_TYPES.has(file.mimeType)) {
    throw new AppError(
      'UNSUPPORTED_FILE_TYPE',
      `MIME type "${file.mimeType}" is not allowed. Allowed: PDF, images, documents, spreadsheets.`,
      400,
    )
  }

  if (!file.fileName || file.fileName.trim().length === 0) {
    throw new AppError('INVALID_FILE_NAME', 'File name is required', 400)
  }

  const db = createTenantPrisma(orgId)

  // 3. Verify the lead exists within the organization and is not soft-deleted
  const lead = await db.lead.findFirst({
    where: { id: leadId, deletedAt: null },
  })

  if (!lead) {
    throw new AppError('LEAD_NOT_FOUND', 'Lead not found', 404)
  }

  // 4. Create a FILE_ATTACHMENT activity so the upload shows in the timeline
  //    and the FileAttachment has an owning activity (required by schema).
  // Note: organizationId is auto-injected by the tenant middleware at runtime
  const activity = await db.activity.create({
    data: {
      type: 'FILE_ATTACHMENT',
      leadId,
      createdById: userId,
      notes: `Uploaded ${file.fileName}`,
    } as any,
  })

  // Update the lead's lastActivityAt to keep it consistent with other activities.
  await db.lead.update({
    where: { id: leadId },
    data: { lastActivityAt: new Date() },
  })

  // 5. Build the storage path with per-organization prefix for tenant isolation.
  const sanitizedName = sanitizeFileName(file.fileName)
  const storagePath = `${orgId}/${leadId}/${activity.id}-${sanitizedName}`

  // 6. Upload to Supabase Storage using the service role client.
  //    The service role bypasses RLS; application-level checks above ensure
  //    the caller has access to the lead and organization.
  const supabase = createSupabaseAdmin()
  const bodyBytes = toUint8Array(file.data)

  const { error: uploadError } = await supabase.storage
    .from(FILE_ATTACHMENTS_BUCKET)
    .upload(storagePath, bodyBytes, {
      contentType: file.mimeType,
      upsert: false,
    })

  if (uploadError) {
    // Roll back the activity we created so we don't leave orphans.
    await db.activity.delete({ where: { id: activity.id } }).catch(() => {})
    throw new AppError(
      'STORAGE_UPLOAD_FAILED',
      `Failed to upload file to storage: ${uploadError.message}`,
      500,
    )
  }

  // 7. Create the FileAttachment record.
  try {
    // Note: organizationId is auto-injected by the tenant middleware at runtime
    const attachment = await db.fileAttachment.create({
      data: {
        activityId: activity.id,
        fileName: file.fileName,
        fileSize: file.size,
        mimeType: file.mimeType,
        storagePath,
        uploadedById: userId,
      } as any,
    })

    return {
      attachmentId: attachment.id,
      storagePath,
      activityId: activity.id,
    }
  } catch (error) {
    // Roll back the storage upload and activity if the DB write fails.
    await supabase.storage
      .from(FILE_ATTACHMENTS_BUCKET)
      .remove([storagePath])
      .catch(() => {})
    await db.activity.delete({ where: { id: activity.id } }).catch(() => {})
    throw error
  }
}

/**
 * Generate a signed download URL for a file attachment.
 *
 * Access control:
 * 1. The attachment must exist within the caller's organization (enforced
 *    via the tenant-scoped Prisma client).
 * 2. The caller must have permission to view the lead the file is attached
 *    to — uses the same RBAC lead access filter so MEMBER users only
 *    receive URLs for their own assigned leads.
 * 3. The generated URL has a short 5-minute expiration.
 *
 * Validates: Requirements 13.2, 13.3
 */
export async function getFileUrl(
  attachmentId: string,
  userId: string,
): Promise<{ url: string; expiresAt: Date }> {
  // Resolve the caller's session to derive orgId and RBAC context server-side.
  const session = await getSession()
  if (!session || session.dbUser.id !== userId) {
    throw new AppError('UNAUTHORIZED', 'Authentication required', 401)
  }

  const db = createTenantPrisma(session.organizationId)

  // Look up the attachment with its parent activity+lead for RBAC scoping.
  const attachment = await db.fileAttachment.findFirst({
    where: { id: attachmentId },
    include: {
      activity: {
        select: { leadId: true },
      },
    },
  })

  if (!attachment) {
    throw new AppError('FILE_NOT_FOUND', 'File not found', 404)
  }

  // Verify the caller has access to the owning lead using the same RBAC filter
  // used for lead queries. This keeps file access consistent with lead access.
  const accessFilter = await getLeadAccessFilter(session.dbUser)
  const accessibleLead = await db.lead.findFirst({
    where: { id: attachment.activity.leadId, ...accessFilter },
    select: { id: true },
  })

  if (!accessibleLead) {
    throw new AppError('FORBIDDEN', 'You do not have access to this file', 403)
  }

  // Generate a short-lived signed URL.
  const supabase = createSupabaseAdmin()
  const { data, error } = await supabase.storage
    .from(FILE_ATTACHMENTS_BUCKET)
    .createSignedUrl(attachment.storagePath, SIGNED_URL_EXPIRATION_SECONDS)

  if (error || !data?.signedUrl) {
    throw new AppError(
      'SIGNED_URL_FAILED',
      `Failed to generate signed URL: ${error?.message ?? 'unknown error'}`,
      500,
    )
  }

  return {
    url: data.signedUrl,
    expiresAt: new Date(Date.now() + SIGNED_URL_EXPIRATION_SECONDS * 1000),
  }
}

/**
 * Sanitize a file name for use in a storage path.
 *
 * - Strips path separators and null bytes
 * - Collapses whitespace to underscores
 * - Restricts to a conservative charset to avoid storage provider quirks
 */
function sanitizeFileName(name: string): string {
  const trimmed = name.replace(/\0/g, '').trim()
  // Replace path separators and control characters
  const noPaths = trimmed.replace(/[\\/]/g, '_')
  // Allow letters, numbers, dot, underscore, hyphen; replace everything else
  // with an underscore so we don't collide on dots or spaces.
  const safe = noPaths.replace(/[^A-Za-z0-9._-]+/g, '_')
  // Avoid leading dots (hidden files) and collapse repeated underscores.
  return safe.replace(/^\.+/, '').replace(/_{2,}/g, '_') || 'file'
}

/**
 * Normalise input bytes into a Uint8Array that the Supabase Storage client
 * accepts as a body.
 */
function toUint8Array(
  data: ArrayBuffer | Buffer | Uint8Array,
): Uint8Array {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  // Buffer is a Uint8Array subclass in Node, but narrow the type for TS.
  return new Uint8Array(data as unknown as ArrayBufferLike)
}
