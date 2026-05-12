import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for the CSV import service.
 *
 * Tests cover:
 * - CSV parsing (headers, rows, quoted fields, edge cases)
 * - Lead import with field mapping, validation, company creation, audit logging
 * - Error handling for invalid rows
 * - successCount + skipCount = totalRows invariant
 *
 * **Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5**
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
  TENANT_SCOPED_MODELS: ['Lead', 'Contact', 'Company', 'AuditEntry', 'Stage', 'StageTransition'],
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

import { parseCSV, importLeads } from '@/server/services/csv-import'
import { prisma } from '@/server/db/client'

const mockPrisma = vi.mocked(prisma)

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CSV Import Service', () => {
  const orgId = '550e8400-e29b-41d4-a716-446655440000'
  const userId = '660e8400-e29b-41d4-a716-446655440001'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('parseCSV', () => {
    it('parses a simple CSV with headers and rows', () => {
      const csv = 'First Name,Last Name,Email\nJohn,Doe,john@example.com\nJane,Smith,jane@example.com'
      const result = parseCSV(csv)

      expect(result.headers).toEqual(['First Name', 'Last Name', 'Email'])
      expect(result.rows).toHaveLength(2)
      expect(result.totalRows).toBe(2)
      expect(result.rows[0]).toEqual(['John', 'Doe', 'john@example.com'])
      expect(result.rows[1]).toEqual(['Jane', 'Smith', 'jane@example.com'])
    })

    it('handles quoted fields with commas', () => {
      const csv = 'Name,Company\n"Doe, John","Acme, Inc."'
      const result = parseCSV(csv)

      expect(result.rows[0]).toEqual(['Doe, John', 'Acme, Inc.'])
    })

    it('handles escaped quotes within quoted fields', () => {
      const csv = 'Name,Note\nJohn,"He said ""hello"""'
      const result = parseCSV(csv)

      expect(result.rows[0]).toEqual(['John', 'He said "hello"'])
    })

    it('handles Windows-style line endings (\\r\\n)', () => {
      const csv = 'Name,Email\r\nJohn,john@test.com\r\nJane,jane@test.com'
      const result = parseCSV(csv)

      expect(result.headers).toEqual(['Name', 'Email'])
      expect(result.rows).toHaveLength(2)
    })

    it('skips empty lines', () => {
      const csv = 'Name,Email\n\nJohn,john@test.com\n\nJane,jane@test.com\n'
      const result = parseCSV(csv)

      expect(result.rows).toHaveLength(2)
    })

    it('throws when CSV content is empty', () => {
      expect(() => parseCSV('')).toThrow('CSV content is empty')
      expect(() => parseCSV('   ')).toThrow('CSV content is empty')
    })

    it('throws when CSV has only headers and no data rows', () => {
      expect(() => parseCSV('Name,Email')).toThrow('CSV file contains no data rows')
    })

    it('trims whitespace from field values', () => {
      const csv = 'Name,Email\n  John  ,  john@test.com  '
      const result = parseCSV(csv)

      expect(result.rows[0]).toEqual(['John', 'john@test.com'])
    })
  })

  describe('importLeads', () => {
    const headers = ['First Name', 'Last Name', 'Email', 'Company']
    const mapping = {
      'First Name': 'firstName',
      'Last Name': 'lastName',
      'Email': 'email',
      'Company': 'companyName',
    }

    it('imports valid rows and returns correct counts', async () => {
      const rows = [
        ['John', 'Doe', 'john@example.com', 'Acme Corp'],
        ['Jane', 'Smith', 'jane@example.com', ''],
      ]

      mockDb.company.findFirst.mockResolvedValue(null)
      mockDb.company.create.mockResolvedValue({ id: 'company-1', name: 'Acme Corp' })
      mockDb.lead.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: `lead-${data.firstName}`, ...data }),
      )
      mockDb.contact.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: `contact-${data.firstName}`, ...data }),
      )
      mockDb.auditEntry.create.mockResolvedValue({})
      mockPrisma.leadContact.create.mockResolvedValue({})

      const result = await importLeads(rows, headers, mapping, userId, orgId)

      expect(result.successCount).toBe(2)
      expect(result.skipCount).toBe(0)
      expect(result.totalRows).toBe(2)
      expect(result.successCount + result.skipCount).toBe(result.totalRows)
    })

    it('skips rows with missing firstName', async () => {
      const rows = [
        ['', 'Doe', 'john@example.com', ''],
      ]

      const result = await importLeads(rows, headers, mapping, userId, orgId)

      expect(result.successCount).toBe(0)
      expect(result.skipCount).toBe(1)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].message).toContain('First name is required')
    })

    it('skips rows with missing lastName', async () => {
      const rows = [
        ['John', '', 'john@example.com', ''],
      ]

      const result = await importLeads(rows, headers, mapping, userId, orgId)

      expect(result.successCount).toBe(0)
      expect(result.skipCount).toBe(1)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].message).toContain('Last name is required')
    })

    it('creates company when companyName is provided and no match exists', async () => {
      const rows = [
        ['John', 'Doe', 'john@example.com', 'New Corp'],
      ]

      mockDb.company.findFirst.mockResolvedValue(null)
      mockDb.company.create.mockResolvedValue({ id: 'company-new', name: 'New Corp' })
      mockDb.lead.create.mockResolvedValue({ id: 'lead-1', firstName: 'John', lastName: 'Doe' })
      mockDb.contact.create.mockResolvedValue({ id: 'contact-1' })
      mockDb.auditEntry.create.mockResolvedValue({})
      mockPrisma.leadContact.create.mockResolvedValue({})

      await importLeads(rows, headers, mapping, userId, orgId)

      expect(mockDb.company.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ name: 'New Corp' }),
      })
    })

    it('reuses existing company when companyName matches', async () => {
      const rows = [
        ['John', 'Doe', 'john@example.com', 'Existing Corp'],
      ]

      mockDb.company.findFirst.mockResolvedValue({ id: 'company-existing', name: 'Existing Corp' })
      mockDb.lead.create.mockResolvedValue({ id: 'lead-1', firstName: 'John', lastName: 'Doe' })
      mockDb.contact.create.mockResolvedValue({ id: 'contact-1' })
      mockDb.auditEntry.create.mockResolvedValue({})
      mockPrisma.leadContact.create.mockResolvedValue({})

      await importLeads(rows, headers, mapping, userId, orgId)

      expect(mockDb.company.create).not.toHaveBeenCalled()
    })

    it('logs audit entry for each imported lead', async () => {
      const rows = [
        ['John', 'Doe', 'john@example.com', ''],
        ['Jane', 'Smith', 'jane@example.com', ''],
      ]

      mockDb.lead.create
        .mockResolvedValueOnce({ id: 'lead-1', firstName: 'John', lastName: 'Doe' })
        .mockResolvedValueOnce({ id: 'lead-2', firstName: 'Jane', lastName: 'Smith' })
      mockDb.contact.create.mockResolvedValue({ id: 'contact-1' })
      mockDb.auditEntry.create.mockResolvedValue({})
      mockPrisma.leadContact.create.mockResolvedValue({})

      await importLeads(rows, headers, mapping, userId, orgId)

      expect(mockDb.auditEntry.create).toHaveBeenCalledTimes(2)
      expect(mockDb.auditEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId,
          action: 'CREATE',
          entityType: 'Lead',
          entityId: 'lead-1',
        }),
      })
    })

    it('ensures successCount + skipCount = totalRows', async () => {
      const rows = [
        ['John', 'Doe', 'john@example.com', ''],
        ['', 'Missing', '', ''],  // invalid - no firstName
        ['Jane', 'Smith', '', ''],
      ]

      mockDb.lead.create
        .mockResolvedValueOnce({ id: 'lead-1', firstName: 'John', lastName: 'Doe' })
        .mockResolvedValueOnce({ id: 'lead-2', firstName: 'Jane', lastName: 'Smith' })
      mockDb.contact.create.mockResolvedValue({ id: 'contact-1' })
      mockDb.auditEntry.create.mockResolvedValue({})
      mockPrisma.leadContact.create.mockResolvedValue({})

      const result = await importLeads(rows, headers, mapping, userId, orgId)

      expect(result.totalRows).toBe(3)
      expect(result.successCount + result.skipCount).toBe(result.totalRows)
      expect(result.successCount).toBe(2)
      expect(result.skipCount).toBe(1)
    })

    it('uses default pipeline first stage when stageId is not mapped', async () => {
      const rows = [
        ['John', 'Doe', '', ''],
      ]

      mockDb.lead.create.mockResolvedValue({ id: 'lead-1', firstName: 'John', lastName: 'Doe' })
      mockDb.auditEntry.create.mockResolvedValue({})

      await importLeads(rows, headers, mapping, userId, orgId)

      expect(mockDb.lead.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ stageId: 'stage-new' }),
      })
    })

    it('does not create contact when email is not provided', async () => {
      const rows = [
        ['John', 'Doe', '', ''],
      ]

      mockDb.lead.create.mockResolvedValue({ id: 'lead-1', firstName: 'John', lastName: 'Doe' })
      mockDb.auditEntry.create.mockResolvedValue({})

      await importLeads(rows, headers, mapping, userId, orgId)

      expect(mockDb.contact.create).not.toHaveBeenCalled()
      expect(mockPrisma.leadContact.create).not.toHaveBeenCalled()
    })

    it('throws when userId is missing', async () => {
      await expect(
        importLeads([], headers, mapping, '', orgId),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      })
    })

    it('throws when orgId is missing', async () => {
      await expect(
        importLeads([], headers, mapping, userId, ''),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      })
    })
  })
})
