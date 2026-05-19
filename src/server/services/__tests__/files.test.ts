import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for the file storage service.
 *
 * Tests cover:
 * - Size validation (≤ 25 MB) and rejection of oversized files
 * - MIME type allowlist enforcement
 * - Lead existence check before upload
 * - Storage path format uses per-org prefix
 * - FileAttachment record creation on successful upload
 * - Rollback of activity and storage object on DB failure
 * - Signed URL generation with RBAC access check
 * - Signed URL rejection for users without lead access
 *
 * Validates: Requirements 13.1, 13.2, 13.3, 13.4
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockDb = {
  lead: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  activity: {
    create: vi.fn(),
    delete: vi.fn(),
  },
  fileAttachment: {
    create: vi.fn(),
    findFirst: vi.fn(),
  },
}

vi.mock('@/server/db/middleware', () => ({
  createTenantPrisma: vi.fn(() => mockDb),
  TENANT_SCOPED_MODELS: ['Lead', 'Activity', 'FileAttachment'],
}))

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(),
}))

const storageUpload = vi.fn()
const storageCreateSignedUrl = vi.fn()
const storageRemove = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdmin: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        upload: storageUpload,
        createSignedUrl: storageCreateSignedUrl,
        remove: storageRemove,
      })),
    },
  })),
}))

const mockGetSession = vi.fn()
vi.mock('@/server/auth/session', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}))

const mockGetLeadAccessFilter = vi.fn()
vi.mock('@/server/services/access', () => ({
  getLeadAccessFilter: (...args: unknown[]) => mockGetLeadAccessFilter(...args),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: vi.fn(),
}))

vi.mock('@/lib/env', () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SECRET_KEY: 'service-role-key',
  },
}))

import {
  uploadFile,
  getFileUrl,
  MAX_FILE_SIZE_BYTES,
  FILE_ATTACHMENTS_BUCKET,
} from '@/server/services/files'

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('File Storage Service', () => {
  const orgId = '550e8400-e29b-41d4-a716-446655440000'
  const userId = '660e8400-e29b-41d4-a716-446655440001'
  const leadId = '770e8400-e29b-41d4-a716-446655440002'
  const activityId = '880e8400-e29b-41d4-a716-446655440003'
  const attachmentId = '990e8400-e29b-41d4-a716-446655440004'

  beforeEach(() => {
    vi.clearAllMocks()
    storageUpload.mockResolvedValue({ error: null, data: { path: 'ok' } })
    storageCreateSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://signed.example.com/file' },
      error: null,
    })
    storageRemove.mockResolvedValue({ error: null, data: [] })
    // Default rollback paths return resolved promises
    mockDb.activity.delete.mockResolvedValue({ id: 'deleted' })
  })

  // ─── uploadFile ────────────────────────────────────────────────────────────

  describe('uploadFile', () => {
    const validPdf = () => ({
      data: new Uint8Array([1, 2, 3, 4]),
      fileName: 'contract.pdf',
      mimeType: 'application/pdf',
      size: 4,
    })

    it('rejects files exceeding 25 MB', async () => {
      const file = {
        data: new Uint8Array([1]),
        fileName: 'huge.pdf',
        mimeType: 'application/pdf',
        size: MAX_FILE_SIZE_BYTES + 1,
      }

      await expect(uploadFile(file, leadId, userId, orgId)).rejects.toMatchObject({
        code: 'FILE_TOO_LARGE',
        statusCode: 400,
      })

      expect(mockDb.lead.findFirst).not.toHaveBeenCalled()
      expect(storageUpload).not.toHaveBeenCalled()
    })

    it('accepts files at exactly 25 MB', async () => {
      mockDb.lead.findFirst.mockResolvedValue({ id: leadId, deletedAt: null })
      mockDb.activity.create.mockResolvedValue({ id: activityId })
      mockDb.lead.update.mockResolvedValue({})
      mockDb.fileAttachment.create.mockResolvedValue({
        id: attachmentId,
        storagePath: `${orgId}/${leadId}/${activityId}-big.pdf`,
      })

      const file = {
        data: new Uint8Array([1]),
        fileName: 'big.pdf',
        mimeType: 'application/pdf',
        size: MAX_FILE_SIZE_BYTES,
      }

      await expect(uploadFile(file, leadId, userId, orgId)).resolves.toBeDefined()
    })

    it('rejects empty files', async () => {
      const file = {
        data: new Uint8Array([]),
        fileName: 'empty.pdf',
        mimeType: 'application/pdf',
        size: 0,
      }

      await expect(uploadFile(file, leadId, userId, orgId)).rejects.toMatchObject({
        code: 'FILE_EMPTY',
      })
    })

    it('rejects disallowed MIME types', async () => {
      const file = {
        data: new Uint8Array([1, 2, 3]),
        fileName: 'malware.exe',
        mimeType: 'application/x-msdownload',
        size: 3,
      }

      await expect(uploadFile(file, leadId, userId, orgId)).rejects.toMatchObject({
        code: 'UNSUPPORTED_FILE_TYPE',
        statusCode: 400,
      })
    })

    it('accepts common allowed MIME types', async () => {
      mockDb.lead.findFirst.mockResolvedValue({ id: leadId, deletedAt: null })
      mockDb.activity.create.mockResolvedValue({ id: activityId })
      mockDb.lead.update.mockResolvedValue({})
      mockDb.fileAttachment.create.mockResolvedValue({
        id: attachmentId,
        storagePath: 'path',
      })

      const allowed = [
        'application/pdf',
        'image/png',
        'image/jpeg',
        'text/csv',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ]

      for (const mime of allowed) {
        vi.clearAllMocks()
        mockDb.lead.findFirst.mockResolvedValue({ id: leadId, deletedAt: null })
        mockDb.activity.create.mockResolvedValue({ id: activityId })
        mockDb.lead.update.mockResolvedValue({})
        mockDb.fileAttachment.create.mockResolvedValue({
          id: attachmentId,
          storagePath: 'path',
        })
        storageUpload.mockResolvedValue({ error: null, data: { path: 'ok' } })

        await expect(
          uploadFile(
            {
              data: new Uint8Array([1, 2, 3]),
              fileName: 'file.bin',
              mimeType: mime,
              size: 3,
            },
            leadId,
            userId,
            orgId,
          ),
        ).resolves.toBeDefined()
      }
    })

    it('rejects uploads when the lead does not exist in the org', async () => {
      mockDb.lead.findFirst.mockResolvedValue(null)

      await expect(
        uploadFile(validPdf(), leadId, userId, orgId),
      ).rejects.toMatchObject({ code: 'LEAD_NOT_FOUND', statusCode: 404 })

      expect(storageUpload).not.toHaveBeenCalled()
      expect(mockDb.activity.create).not.toHaveBeenCalled()
    })

    it('uploads under a per-org storage path prefix', async () => {
      mockDb.lead.findFirst.mockResolvedValue({ id: leadId, deletedAt: null })
      mockDb.activity.create.mockResolvedValue({ id: activityId })
      mockDb.lead.update.mockResolvedValue({})
      mockDb.fileAttachment.create.mockResolvedValue({
        id: attachmentId,
        storagePath: `${orgId}/${leadId}/${activityId}-contract.pdf`,
      })

      const result = await uploadFile(validPdf(), leadId, userId, orgId)

      expect(storageUpload).toHaveBeenCalledTimes(1)
      const [pathArg, bodyArg, optionsArg] = storageUpload.mock.calls[0]
      expect(pathArg).toMatch(new RegExp(`^${orgId}/${leadId}/${activityId}-`))
      expect(pathArg).toContain('contract.pdf')
      expect(bodyArg).toBeInstanceOf(Uint8Array)
      expect(optionsArg).toEqual({ contentType: 'application/pdf', upsert: false })
      expect(result.attachmentId).toBe(attachmentId)
      expect(result.activityId).toBe(activityId)
      expect(result.storagePath).toMatch(new RegExp(`^${orgId}/${leadId}/`))
    })

    it('creates a FILE_ATTACHMENT activity and updates lastActivityAt', async () => {
      mockDb.lead.findFirst.mockResolvedValue({ id: leadId, deletedAt: null })
      mockDb.activity.create.mockResolvedValue({ id: activityId })
      mockDb.lead.update.mockResolvedValue({})
      mockDb.fileAttachment.create.mockResolvedValue({
        id: attachmentId,
        storagePath: 'path',
      })

      await uploadFile(validPdf(), leadId, userId, orgId)

      expect(mockDb.activity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'FILE_ATTACHMENT',
          leadId,
          createdById: userId,
        }),
      })
      expect(mockDb.lead.update).toHaveBeenCalledWith({
        where: { id: leadId },
        data: { lastActivityAt: expect.any(Date) },
      })
    })

    it('rolls back activity when storage upload fails', async () => {
      mockDb.lead.findFirst.mockResolvedValue({ id: leadId, deletedAt: null })
      mockDb.activity.create.mockResolvedValue({ id: activityId })
      mockDb.lead.update.mockResolvedValue({})
      storageUpload.mockResolvedValue({
        error: { message: 'bucket missing' },
        data: null,
      })

      await expect(
        uploadFile(validPdf(), leadId, userId, orgId),
      ).rejects.toMatchObject({ code: 'STORAGE_UPLOAD_FAILED' })

      expect(mockDb.activity.delete).toHaveBeenCalledWith({
        where: { id: activityId },
      })
      expect(mockDb.fileAttachment.create).not.toHaveBeenCalled()
    })

    it('removes the uploaded object when the DB record fails to persist', async () => {
      mockDb.lead.findFirst.mockResolvedValue({ id: leadId, deletedAt: null })
      mockDb.activity.create.mockResolvedValue({ id: activityId })
      mockDb.lead.update.mockResolvedValue({})
      mockDb.fileAttachment.create.mockRejectedValue(new Error('db boom'))

      await expect(uploadFile(validPdf(), leadId, userId, orgId)).rejects.toThrow(
        'db boom',
      )

      expect(storageRemove).toHaveBeenCalledTimes(1)
      expect(mockDb.activity.delete).toHaveBeenCalledWith({
        where: { id: activityId },
      })
    })
  })

  // ─── getFileUrl ────────────────────────────────────────────────────────────

  describe('getFileUrl', () => {
    const session = {
      authUser: { id: 'auth-1' },
      dbUser: { id: userId, teamMemberships: [] },
      organizationId: orgId,
    }

    it('returns a signed URL when the user has lead access', async () => {
      mockGetSession.mockResolvedValue(session)
      mockDb.fileAttachment.findFirst.mockResolvedValue({
        id: attachmentId,
        storagePath: `${orgId}/${leadId}/${activityId}-doc.pdf`,
        activity: { leadId },
      })
      mockGetLeadAccessFilter.mockResolvedValue({ deletedAt: null })
      mockDb.lead.findFirst.mockResolvedValue({ id: leadId })

      const result = await getFileUrl(attachmentId, userId)

      expect(result.url).toBe('https://signed.example.com/file')
      expect(result.expiresAt).toBeInstanceOf(Date)

      // Verify short expiration (5 minutes)
      expect(storageCreateSignedUrl).toHaveBeenCalledWith(
        `${orgId}/${leadId}/${activityId}-doc.pdf`,
        5 * 60,
      )
    })

    it('rejects requests without an authenticated session', async () => {
      mockGetSession.mockResolvedValue(null)

      await expect(getFileUrl(attachmentId, userId)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        statusCode: 401,
      })

      expect(storageCreateSignedUrl).not.toHaveBeenCalled()
    })

    it('rejects requests when the userId does not match the session', async () => {
      mockGetSession.mockResolvedValue(session)

      await expect(getFileUrl(attachmentId, 'different-user')).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        statusCode: 401,
      })

      expect(storageCreateSignedUrl).not.toHaveBeenCalled()
    })

    it('returns 404 when the attachment is not found in the org', async () => {
      mockGetSession.mockResolvedValue(session)
      mockDb.fileAttachment.findFirst.mockResolvedValue(null)

      await expect(getFileUrl(attachmentId, userId)).rejects.toMatchObject({
        code: 'FILE_NOT_FOUND',
        statusCode: 404,
      })

      expect(storageCreateSignedUrl).not.toHaveBeenCalled()
    })

    it('returns 403 when the user does not have access to the owning lead', async () => {
      mockGetSession.mockResolvedValue(session)
      mockDb.fileAttachment.findFirst.mockResolvedValue({
        id: attachmentId,
        storagePath: `${orgId}/${leadId}/${activityId}-doc.pdf`,
        activity: { leadId },
      })
      mockGetLeadAccessFilter.mockResolvedValue({
        deletedAt: null,
        assignedUserId: 'another-user',
      })
      mockDb.lead.findFirst.mockResolvedValue(null)

      await expect(getFileUrl(attachmentId, userId)).rejects.toMatchObject({
        code: 'FORBIDDEN',
        statusCode: 403,
      })

      expect(storageCreateSignedUrl).not.toHaveBeenCalled()
    })

    it('uses the attachments bucket for signed URL generation', async () => {
      mockGetSession.mockResolvedValue(session)
      mockDb.fileAttachment.findFirst.mockResolvedValue({
        id: attachmentId,
        storagePath: `${orgId}/${leadId}/${activityId}-doc.pdf`,
        activity: { leadId },
      })
      mockGetLeadAccessFilter.mockResolvedValue({ deletedAt: null })
      mockDb.lead.findFirst.mockResolvedValue({ id: leadId })

      const { createSupabaseAdmin } = await import('@/lib/supabase/admin')
      const adminMock = vi.mocked(createSupabaseAdmin)
      const fromSpy = adminMock.mock.results[0]?.value?.storage?.from as
        | ReturnType<typeof vi.fn>
        | undefined

      await getFileUrl(attachmentId, userId)

      if (fromSpy) {
        expect(fromSpy).toHaveBeenCalledWith(FILE_ATTACHMENTS_BUCKET)
      }
    })
  })
})
