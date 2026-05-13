import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

/**
 * Property-based tests for the CSV import service.
 *
 * These tests verify that:
 * 1. successCount + skipCount always equals totalRows
 * 2. Importing N valid rows increases lead count by exactly N
 * 3. Invalid rows are skipped without affecting valid row processing
 *
 * **Validates: Requirements 11.3, 11.4, 11.5**
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockDb = {
  stage: {
    findFirst: vi.fn(),
  },
  company: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  lead: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  contact: {
    create: vi.fn(),
  },
  auditEntry: {
    create: vi.fn(),
  },
  stageTransition: {
    create: vi.fn(),
  },
}

vi.mock('@/server/db/middleware', () => ({
  createTenantPrisma: vi.fn(() => mockDb),
  TENANT_SCOPED_MODELS: [
    'Lead',
    'Contact',
    'Company',
    'AuditEntry',
    'Stage',
    'StageTransition',
  ],
}))

vi.mock('@/server/db/client', () => ({
  prisma: {
    leadContact: {
      create: vi.fn(),
    },
  },
}))

vi.mock('@/server/services/pipeline', () => ({
  getOrCreateDefaultPipeline: vi.fn(() =>
    Promise.resolve({
      id: 'pipeline-1',
      name: 'Sales Pipeline',
      stages: [
        { id: 'stage-new', name: 'New', order: 1 },
        { id: 'stage-qualified', name: 'Qualified', order: 2 },
      ],
    }),
  ),
  createStageTransition: vi.fn(() => Promise.resolve({ id: 'transition-1' })),
}))

vi.mock('@/generated/prisma', () => ({
  PrismaClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: vi.fn(),
}))

import { importLeads } from '@/server/services/csv-import'
import { prisma } from '@/server/db/client'

const mockPrisma = vi.mocked(prisma)

// ─── Generators ──────────────────────────────────────────────────────────────

const HEADERS = ['First Name', 'Last Name', 'Email', 'Company']
const MAPPING = {
  'First Name': 'firstName',
  'Last Name': 'lastName',
  Email: 'email',
  Company: 'companyName',
}

/**
 * Generate a non-empty token without commas, quotes, or special chars that could
 * break mapping. Constrained to alphanumeric + space to represent realistic names.
 */
const nameArb = fc
  .string({ minLength: 1, maxLength: 20 })
  .map((s) => s.replace(/[",\r\n\t]/g, '').trim())
  .filter((s) => s.length > 0)

/**
 * Optional email field — either empty string or a simple valid email.
 * We avoid complex email strings since they are not the target of this test.
 */
const emailArb = fc.oneof(
  fc.constant(''),
  fc
    .tuple(
      fc.stringMatching(/^[a-z][a-z0-9]{0,10}$/),
      fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/),
    )
    .map(([local, domain]) => `${local}@${domain}.com`),
)

/** Optional company name — either empty or a simple string. */
const companyArb = fc.oneof(
  fc.constant(''),
  fc
    .string({ minLength: 1, maxLength: 15 })
    .map((s) => s.replace(/[",\r\n\t]/g, '').trim())
    .filter((s) => s.length > 0),
)

/**
 * A valid CSV row — both firstName and lastName are non-empty and valid.
 * email and company may be empty strings.
 */
const validRowArb = fc
  .tuple(nameArb, nameArb, emailArb, companyArb)
  .map(([firstName, lastName, email, company]) => [
    firstName,
    lastName,
    email,
    company,
  ])

/**
 * An invalid CSV row — at least one of firstName/lastName is empty.
 * This matches the validation rule in csv-import.ts (firstName and lastName required).
 */
const invalidRowArb = fc.oneof(
  // Empty firstName
  fc
    .tuple(fc.constant(''), nameArb, emailArb, companyArb)
    .map(([f, l, e, c]) => [f, l, e, c]),
  // Empty lastName
  fc
    .tuple(nameArb, fc.constant(''), emailArb, companyArb)
    .map(([f, l, e, c]) => [f, l, e, c]),
  // Both empty
  fc
    .tuple(fc.constant(''), fc.constant(''), emailArb, companyArb)
    .map(([f, l, e, c]) => [f, l, e, c]),
)

// ─── Mock Setup Helpers ──────────────────────────────────────────────────────

/**
 * Reset mocks and wire them to happy-path defaults so lead creation succeeds.
 * Returns a counter that tracks lead.create call count, which represents the
 * "lead count increase" during an import run.
 */
function setupHappyPathMocks() {
  vi.clearAllMocks()

  // No duplicates by default — any generated row is treated as fresh.
  mockDb.lead.findFirst.mockResolvedValue(null)

  mockDb.company.findFirst.mockResolvedValue(null)
  mockDb.company.create.mockImplementation(({ data }: any) =>
    Promise.resolve({ id: `company-${Math.random()}`, name: data.name }),
  )

  let leadCounter = 0
  mockDb.lead.create.mockImplementation(({ data }: any) => {
    leadCounter++
    return Promise.resolve({
      id: `lead-${leadCounter}`,
      firstName: data.firstName,
      lastName: data.lastName,
    })
  })

  mockDb.contact.create.mockImplementation(({ data }: any) =>
    Promise.resolve({ id: `contact-${Math.random()}`, ...data }),
  )
  mockDb.auditEntry.create.mockResolvedValue({})
  ;(mockPrisma.leadContact.create as any).mockResolvedValue({})

  return { getLeadCount: () => leadCounter }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CSV Import Service - Property Tests', () => {
  const orgId = '550e8400-e29b-41d4-a716-446655440000'
  const userId = '660e8400-e29b-41d4-a716-446655440001'

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.lead.findFirst.mockResolvedValue(null)
  })

  describe('Property: successCount + skipCount always equals totalRows', () => {
    /**
     * **Validates: Requirements 11.5**
     *
     * For any mix of valid and invalid rows, the import result must satisfy
     * the accounting invariant: every row is either counted as a success or a skip.
     */

    it('holds for any mix of valid and invalid rows', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.oneof(validRowArb, invalidRowArb), {
            minLength: 0,
            maxLength: 20,
          }),
          async (rows) => {
            setupHappyPathMocks()

            const result = await importLeads(
              rows,
              HEADERS,
              MAPPING,
              userId,
              orgId,
            )

            expect(result.totalRows).toBe(rows.length)
            expect(result.successCount + result.skipCount).toBe(
              result.totalRows,
            )
            expect(result.successCount).toBeGreaterThanOrEqual(0)
            expect(result.skipCount).toBeGreaterThanOrEqual(0)
          },
        ),
        { numRuns: 100 },
      )
    })

    it('holds even when all rows are invalid', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(invalidRowArb, { minLength: 1, maxLength: 20 }),
          async (rows) => {
            setupHappyPathMocks()

            const result = await importLeads(
              rows,
              HEADERS,
              MAPPING,
              userId,
              orgId,
            )

            expect(result.successCount).toBe(0)
            expect(result.skipCount).toBe(rows.length)
            expect(result.successCount + result.skipCount).toBe(
              result.totalRows,
            )
          },
        ),
        { numRuns: 50 },
      )
    })

    it('holds for an empty input', async () => {
      setupHappyPathMocks()

      const result = await importLeads([], HEADERS, MAPPING, userId, orgId)

      expect(result.totalRows).toBe(0)
      expect(result.successCount).toBe(0)
      expect(result.skipCount).toBe(0)
      expect(result.successCount + result.skipCount).toBe(result.totalRows)
    })
  })

  describe('Property: Importing N valid rows increases lead count by exactly N', () => {
    /**
     * **Validates: Requirements 11.3**
     *
     * When all rows pass validation, the import service must create exactly
     * one lead per row — no more, no less. We verify this by counting actual
     * lead.create invocations on the tenant Prisma mock.
     */

    it('creates exactly N leads when importing N valid rows', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(validRowArb, { minLength: 1, maxLength: 15 }),
          async (validRows) => {
            const { getLeadCount } = setupHappyPathMocks()
            const countBefore = getLeadCount()

            const result = await importLeads(
              validRows,
              HEADERS,
              MAPPING,
              userId,
              orgId,
            )

            const countAfter = getLeadCount()
            const leadsCreated = countAfter - countBefore

            expect(result.successCount).toBe(validRows.length)
            expect(result.skipCount).toBe(0)
            expect(leadsCreated).toBe(validRows.length)
            expect(mockDb.lead.create).toHaveBeenCalledTimes(validRows.length)
          },
        ),
        { numRuns: 100 },
      )
    })

    it('creates exactly one audit entry per imported lead', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(validRowArb, { minLength: 1, maxLength: 10 }),
          async (validRows) => {
            setupHappyPathMocks()

            const result = await importLeads(
              validRows,
              HEADERS,
              MAPPING,
              userId,
              orgId,
            )

            expect(result.successCount).toBe(validRows.length)
            expect(mockDb.auditEntry.create).toHaveBeenCalledTimes(
              validRows.length,
            )
          },
        ),
        { numRuns: 50 },
      )
    })
  })

  describe('Property: Invalid rows are skipped without affecting valid row processing', () => {
    /**
     * **Validates: Requirements 11.4**
     *
     * Invalid rows must not prevent valid rows from being imported, regardless
     * of where they appear in the input. We verify this by comparing the
     * successCount of a pure-valid batch against the successCount of the same
     * valid rows interleaved with arbitrary invalid rows — they must match.
     */

    it('successCount for valid rows is unchanged by adding invalid rows anywhere', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(validRowArb, { minLength: 1, maxLength: 10 }),
          fc.array(invalidRowArb, { minLength: 0, maxLength: 10 }),
          // Permutation seed: an array of indices controlling the interleave order
          fc.array(fc.double({ min: 0, max: 1, noNaN: true }), {
            minLength: 0,
            maxLength: 20,
          }),
          async (validRows, invalidRows, permSeed) => {
            // Import 1: only valid rows
            setupHappyPathMocks()
            const validOnlyResult = await importLeads(
              validRows,
              HEADERS,
              MAPPING,
              userId,
              orgId,
            )

            // Build an interleaved batch using the permutation seed
            const combined: Array<{ row: string[]; isValid: boolean }> = [
              ...validRows.map((row) => ({ row, isValid: true })),
              ...invalidRows.map((row) => ({ row, isValid: false })),
            ]
            // Deterministic shuffle based on permSeed (pad/truncate to length)
            const seeds = Array.from(
              { length: combined.length },
              (_, i) => permSeed[i % Math.max(permSeed.length, 1)] ?? i / combined.length,
            )
            const interleaved = combined
              .map((item, i) => ({ item, key: seeds[i] + i * 1e-9 }))
              .sort((a, b) => a.key - b.key)
              .map(({ item }) => item)

            const mixedRows = interleaved.map((x) => x.row)
            const expectedValidCount = interleaved.filter((x) => x.isValid)
              .length

            // Import 2: valid + invalid interleaved
            setupHappyPathMocks()
            const mixedResult = await importLeads(
              mixedRows,
              HEADERS,
              MAPPING,
              userId,
              orgId,
            )

            // The number of successfully imported leads should equal the
            // number of valid rows in the mixed batch.
            expect(mixedResult.successCount).toBe(expectedValidCount)
            expect(mixedResult.successCount).toBe(validOnlyResult.successCount)
            expect(mixedResult.skipCount).toBe(invalidRows.length)
            expect(mixedResult.totalRows).toBe(mixedRows.length)
          },
        ),
        { numRuns: 50 },
      )
    })

    it('every invalid row produces exactly one error entry and no lead is created for it', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(validRowArb, { minLength: 0, maxLength: 10 }),
          fc.array(invalidRowArb, { minLength: 1, maxLength: 10 }),
          async (validRows, invalidRows) => {
            setupHappyPathMocks()

            const mixedRows = [...validRows, ...invalidRows]
            const result = await importLeads(
              mixedRows,
              HEADERS,
              MAPPING,
              userId,
              orgId,
            )

            expect(result.successCount).toBe(validRows.length)
            expect(result.skipCount).toBe(invalidRows.length)
            expect(result.errors).toHaveLength(invalidRows.length)
            // lead.create should have been called exactly successCount times
            expect(mockDb.lead.create).toHaveBeenCalledTimes(
              result.successCount,
            )
          },
        ),
        { numRuns: 50 },
      )
    })

    it('invalid rows do not trigger company or audit creation for themselves', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(invalidRowArb, { minLength: 1, maxLength: 10 }),
          async (invalidRows) => {
            setupHappyPathMocks()

            const result = await importLeads(
              invalidRows,
              HEADERS,
              MAPPING,
              userId,
              orgId,
            )

            expect(result.successCount).toBe(0)
            expect(result.skipCount).toBe(invalidRows.length)
            expect(mockDb.lead.create).not.toHaveBeenCalled()
            expect(mockDb.company.create).not.toHaveBeenCalled()
            expect(mockDb.auditEntry.create).not.toHaveBeenCalled()
          },
        ),
        { numRuns: 50 },
      )
    })
  })
})
