import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

/**
 * Property-based tests for the file storage service.
 *
 * These tests verify three invariants of the file storage layer:
 *
 * 1. Round-trip: Uploading a file then downloading it returns identical
 *    bytes — no corruption or re-encoding happens in the storage path.
 * 2. Size limit: Files larger than 25 MB are always rejected with
 *    `FILE_TOO_LARGE`, regardless of the other inputs.
 * 3. RBAC: File access applies the exact lead access filter returned by
 *    `getLeadAccessFilter`; access is granted iff the owning lead passes
 *    that filter.
 *
 * **Validates: Requirements 13.1, 13.2, 13.3**
 */

// ─── In-memory storage simulation ────────────────────────────────────────────

/**
 * Simulates Supabase Storage as an in-memory map keyed by storage path.
 * Used by the round-trip property test to verify that the bytes uploaded
 * are the exact bytes that can later be downloaded.
 */
const storageBackend = new Map<string, Uint8Array>()

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

vi.mock('@/generated/prisma', () => ({
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
  ALLOWED_MIME_TYPES,
} from '@/server/services/files'

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const uuidArb = fc.uuid()

/**
 * Generate a MIME type from the allowlist so uploads pass the type check.
 */
const allowedMimeArb = fc.constantFrom(...Array.from(ALLOWED_MIME_TYPES))

/**
 * Generate a sanitizable, non-empty file name. Keep contents bounded so
 * fast-check shrinking remains cheap.
 */
const fileNameArb = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0 && !s.includes('\0'))
  .map((s) => `${s}.bin`)

/**
 * Generate byte content between 1 byte and 4 KB. Content is kept small so
 * the in-memory storage map doesn't balloon during property runs.
 */
const fileBytesArb = fc
  .uint8Array({ minLength: 1, maxLength: 4096 })

/**
 * A valid file payload within size and MIME limits.
 */
const validFileArb = fc.record({
  data: fileBytesArb,
  fileName: fileNameArb,
  mimeType: allowedMimeArb,
})

/**
 * Generate a size strictly larger than the 25 MB cap. Capped at a modest
 * upper bound so numeric generation stays fast.
 */
const oversizedArb = fc.integer({
  min: MAX_FILE_SIZE_BYTES + 1,
  max: MAX_FILE_SIZE_BYTES * 4,
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Reset all mocks and wire the Supabase Storage mocks to an in-memory
 * backend so upload/download go through the same bytes.
 */
function resetMocksWithInMemoryStorage() {
  vi.clearAllMocks()
  storageBackend.clear()

  storageUpload.mockImplementation(
    async (path: string, body: Uint8Array | ArrayBuffer | Buffer) => {
      const bytes =
        body instanceof Uint8Array
          ? new Uint8Array(body) // defensive copy
          : body instanceof ArrayBuffer
            ? new Uint8Array(body)
            : new Uint8Array(body as unknown as ArrayBufferLike)
      storageBackend.set(path, bytes)
      return { data: { path }, error: null }
    },
  )

  storageCreateSignedUrl.mockImplementation(async (path: string) => {
    if (!storageBackend.has(path)) {
      return { data: null, error: { message: 'object not found' } }
    }
    return {
      data: { signedUrl: `https://signed.example.com/${encodeURIComponent(path)}` },
      error: null,
    }
  })

  storageRemove.mockImplementation(async (paths: string[]) => {
    for (const p of paths) storageBackend.delete(p)
    return { data: [], error: null }
  })

  mockDb.activity.delete.mockResolvedValue({ id: 'deleted' })
}

/**
 * Retrieve the raw bytes for a stored path as they would be served by the
 * signed URL. This simulates the download half of the round-trip.
 */
function downloadStoredBytes(storagePath: string): Uint8Array | undefined {
  return storageBackend.get(storagePath)
}

/**
 * Build a minimal SessionUser shape sufficient for `getFileUrl`. The real
 * RBAC logic is exercised through `mockGetLeadAccessFilter`, so we only
 * need identity fields here.
 */
function buildSession(userId: string, orgId: string) {
  return {
    authUser: { id: `auth-${userId}` },
    dbUser: { id: userId, teamMemberships: [] },
    organizationId: orgId,
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('File Storage - Property Tests', () => {
  beforeEach(() => {
    resetMocksWithInMemoryStorage()
  })

  // ── Property 1: Upload → download round-trip ────────────────────────────

  describe('Property: Uploading a file then downloading it returns identical content', () => {
    /**
     * **Validates: Requirements 13.1, 13.3**
     *
     * For any valid file (allowed MIME, size within cap, non-empty name),
     * the bytes persisted by `uploadFile` are byte-for-byte identical to
     * the bytes retrieved for the attachment's storage path when
     * `getFileUrl` generates a signed URL. There is no encoding/decoding
     * step in between that could alter content.
     */
    it('upload then download returns byte-identical content', async () => {
      await fc.assert(
        fc.asyncProperty(
          validFileArb,
          uuidArb, // leadId
          uuidArb, // userId
          uuidArb, // orgId
          async (file, leadId, userId, orgId) => {
            resetMocksWithInMemoryStorage()

            const activityId = 'activity-' + leadId.slice(0, 8)
            const attachmentId = 'attachment-' + leadId.slice(0, 8)

            // Arrange: lead exists, activity+attachment records are created.
            mockDb.lead.findFirst.mockResolvedValue({
              id: leadId,
              deletedAt: null,
            })
            mockDb.activity.create.mockResolvedValue({ id: activityId })
            mockDb.lead.update.mockResolvedValue({})
            mockDb.fileAttachment.create.mockImplementation(
              async ({ data }: { data: { storagePath: string } }) => ({
                id: attachmentId,
                storagePath: data.storagePath,
                fileName: file.fileName,
                fileSize: file.data.length,
                mimeType: file.mimeType,
              }),
            )

            // Act: upload the file.
            const uploaded = await uploadFile(
              {
                data: file.data,
                fileName: file.fileName,
                mimeType: file.mimeType,
                size: file.data.length,
              },
              leadId,
              userId,
              orgId,
            )

            // Arrange for download: session + RBAC permit access.
            mockGetSession.mockResolvedValue(buildSession(userId, orgId))
            mockDb.fileAttachment.findFirst.mockResolvedValue({
              id: attachmentId,
              storagePath: uploaded.storagePath,
              activity: { leadId },
            })
            mockGetLeadAccessFilter.mockResolvedValue({ deletedAt: null })
            mockDb.lead.findFirst.mockResolvedValue({ id: leadId })

            // Act: request a signed URL (proves the object is reachable at
            // the upload path and that path matches what Storage serves).
            const { url } = await getFileUrl(attachmentId, userId)
            expect(url).toContain('signed.example.com')

            // Assert: the bytes retrievable for the storage path are
            // exactly those that were uploaded.
            const downloaded = downloadStoredBytes(uploaded.storagePath)
            expect(downloaded).toBeDefined()
            expect(downloaded!.length).toBe(file.data.length)
            for (let i = 0; i < file.data.length; i++) {
              expect(downloaded![i]).toBe(file.data[i])
            }
          },
        ),
        { numRuns: 50 },
      )
    })
  })

  // ── Property 2: 25 MB upper bound ────────────────────────────────────────

  describe('Property: Files exceeding 25 MB are always rejected', () => {
    /**
     * **Validates: Requirements 13.1 (size validation subpoint)**
     *
     * For any file whose declared size is strictly greater than
     * `MAX_FILE_SIZE_BYTES` (25 MB), `uploadFile` rejects with
     * `FILE_TOO_LARGE` and never reaches the DB or Storage layer.
     * This holds regardless of MIME type, name, or payload.
     */
    it('any file with size > 25 MB is rejected before any DB or storage work', async () => {
      await fc.assert(
        fc.asyncProperty(
          oversizedArb,
          fileNameArb,
          allowedMimeArb,
          uuidArb,
          uuidArb,
          uuidArb,
          async (oversizedBytes, fileName, mimeType, leadId, userId, orgId) => {
            resetMocksWithInMemoryStorage()

            // Payload bytes can be tiny — validation uses the declared size.
            const file = {
              data: new Uint8Array([1, 2, 3]),
              fileName,
              mimeType,
              size: oversizedBytes,
            }

            let thrown: unknown = null
            try {
              await uploadFile(file, leadId, userId, orgId)
            } catch (err) {
              thrown = err
            }

            expect(thrown).toBeTruthy()
            expect(thrown).toMatchObject({
              code: 'FILE_TOO_LARGE',
              statusCode: 400,
            })

            // No persistence side effects occurred.
            expect(mockDb.lead.findFirst).not.toHaveBeenCalled()
            expect(mockDb.activity.create).not.toHaveBeenCalled()
            expect(mockDb.fileAttachment.create).not.toHaveBeenCalled()
            expect(storageUpload).not.toHaveBeenCalled()
          },
        ),
        { numRuns: 100 },
      )
    })

    it('files at exactly 25 MB are accepted (boundary inclusive)', async () => {
      await fc.assert(
        fc.asyncProperty(
          fileNameArb,
          allowedMimeArb,
          uuidArb,
          uuidArb,
          uuidArb,
          async (fileName, mimeType, leadId, userId, orgId) => {
            resetMocksWithInMemoryStorage()
            mockDb.lead.findFirst.mockResolvedValue({
              id: leadId,
              deletedAt: null,
            })
            mockDb.activity.create.mockResolvedValue({ id: 'activity-1' })
            mockDb.lead.update.mockResolvedValue({})
            mockDb.fileAttachment.create.mockImplementation(
              async ({ data }: { data: { storagePath: string } }) => ({
                id: 'attachment-1',
                storagePath: data.storagePath,
              }),
            )

            await expect(
              uploadFile(
                {
                  data: new Uint8Array([1]),
                  fileName,
                  mimeType,
                  size: MAX_FILE_SIZE_BYTES,
                },
                leadId,
                userId,
                orgId,
              ),
            ).resolves.toBeDefined()
          },
        ),
        { numRuns: 25 },
      )
    })
  })

  // ── Property 3: RBAC parity ─────────────────────────────────────────────

  describe('Property: File access respects the same RBAC rules as lead access', () => {
    /**
     * **Validates: Requirements 13.2**
     *
     * `getFileUrl` always consults `getLeadAccessFilter` and spreads the
     * returned filter into the `lead.findFirst` query used to gate access.
     * When the filter excludes the owning lead (no lead found), a 403 is
     * raised. When the filter admits the lead, a signed URL is returned.
     * This means file access and lead access share the exact same rules.
     */

    const attachmentScenarioArb = fc.record({
      leadId: uuidArb,
      userId: uuidArb,
      orgId: uuidArb,
      attachmentId: uuidArb,
      storagePath: fc
        .tuple(uuidArb, uuidArb, uuidArb, fileNameArb)
        .map(([o, l, a, n]) => `${o}/${l}/${a}-${n}`),
    })

    it('when the lead access filter admits the lead, getFileUrl returns a signed URL using that exact filter', async () => {
      await fc.assert(
        fc.asyncProperty(
          attachmentScenarioArb,
          // Any filter shape returned by getLeadAccessFilter should be
          // forwarded unchanged into the lead.findFirst call.
          fc.oneof(
            fc.constant({ deletedAt: null }),
            fc.constant({ deletedAt: null, assignedUserId: 'user-x' }),
            fc.record({
              deletedAt: fc.constant(null),
              assignedUserId: fc.record({
                in: fc.array(uuidArb, { minLength: 1, maxLength: 3 }),
              }),
            }),
          ),
          async (scenario, accessFilter) => {
            resetMocksWithInMemoryStorage()

            // Pre-populate storage so the signed URL mock can succeed.
            storageBackend.set(scenario.storagePath, new Uint8Array([0]))

            mockGetSession.mockResolvedValue(
              buildSession(scenario.userId, scenario.orgId),
            )
            mockDb.fileAttachment.findFirst.mockResolvedValue({
              id: scenario.attachmentId,
              storagePath: scenario.storagePath,
              activity: { leadId: scenario.leadId },
            })
            mockGetLeadAccessFilter.mockResolvedValue(accessFilter)
            // Filter admits the lead (findFirst returns a row).
            mockDb.lead.findFirst.mockResolvedValue({ id: scenario.leadId })

            const result = await getFileUrl(scenario.attachmentId, scenario.userId)

            expect(result.url).toContain('signed.example.com')
            expect(result.expiresAt).toBeInstanceOf(Date)

            // The exact filter returned by getLeadAccessFilter must be
            // spread into the lead existence check — this is what
            // guarantees file RBAC == lead RBAC.
            expect(mockDb.lead.findFirst).toHaveBeenCalledWith(
              expect.objectContaining({
                where: expect.objectContaining({
                  id: scenario.leadId,
                  ...accessFilter,
                }),
              }),
            )
          },
        ),
        { numRuns: 50 },
      )
    })

    it('when the lead access filter excludes the lead, getFileUrl raises FORBIDDEN', async () => {
      await fc.assert(
        fc.asyncProperty(attachmentScenarioArb, async (scenario) => {
          resetMocksWithInMemoryStorage()

          mockGetSession.mockResolvedValue(
            buildSession(scenario.userId, scenario.orgId),
          )
          mockDb.fileAttachment.findFirst.mockResolvedValue({
            id: scenario.attachmentId,
            storagePath: scenario.storagePath,
            activity: { leadId: scenario.leadId },
          })
          mockGetLeadAccessFilter.mockResolvedValue({
            deletedAt: null,
            assignedUserId: 'someone-else',
          })
          // Filter excludes the lead (no row returned).
          mockDb.lead.findFirst.mockResolvedValue(null)

          await expect(
            getFileUrl(scenario.attachmentId, scenario.userId),
          ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 })

          // A signed URL is never generated when access is denied.
          expect(storageCreateSignedUrl).not.toHaveBeenCalled()
        }),
        { numRuns: 50 },
      )
    })

    it('getFileUrl always invokes getLeadAccessFilter before deciding access', async () => {
      await fc.assert(
        fc.asyncProperty(
          attachmentScenarioArb,
          fc.boolean(), // grant/deny
          async (scenario, grant) => {
            resetMocksWithInMemoryStorage()
            storageBackend.set(scenario.storagePath, new Uint8Array([0]))

            mockGetSession.mockResolvedValue(
              buildSession(scenario.userId, scenario.orgId),
            )
            mockDb.fileAttachment.findFirst.mockResolvedValue({
              id: scenario.attachmentId,
              storagePath: scenario.storagePath,
              activity: { leadId: scenario.leadId },
            })
            mockGetLeadAccessFilter.mockResolvedValue({ deletedAt: null })
            mockDb.lead.findFirst.mockResolvedValue(
              grant ? { id: scenario.leadId } : null,
            )

            try {
              await getFileUrl(scenario.attachmentId, scenario.userId)
            } catch {
              // Denied path — still expect getLeadAccessFilter to have been consulted.
            }

            expect(mockGetLeadAccessFilter).toHaveBeenCalledTimes(1)
            expect(mockGetLeadAccessFilter).toHaveBeenCalledWith(
              expect.objectContaining({ id: scenario.userId }),
              scenario.orgId,
            )
          },
        ),
        { numRuns: 50 },
      )
    })
  })
})
