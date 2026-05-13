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
  fieldMapping: {
    create: vi.fn(),
    findMany: vi.fn(),
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

import { parseCSV, importLeads, previewImport, saveFieldMapping, getFieldMappings } from '@/server/services/csv-import'
import { prisma } from '@/server/db/client'

const mockPrisma = vi.mocked(prisma)

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CSV Import Service', () => {
  const orgId = '550e8400-e29b-41d4-a716-446655440000'
  const userId = '660e8400-e29b-41d4-a716-446655440001'

  beforeEach(() => {
    vi.clearAllMocks()
    // By default, duplicate detection returns no match — tests opt in when
    // they want to simulate a duplicate.
    mockDb.lead.findFirst.mockResolvedValue(null)
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
      ;(mockPrisma.leadContact.create as any).mockResolvedValue({})

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
      ;(mockPrisma.leadContact.create as any).mockResolvedValue({})

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
      ;(mockPrisma.leadContact.create as any).mockResolvedValue({})

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
      ;(mockPrisma.leadContact.create as any).mockResolvedValue({})

      await importLeads(rows, headers, mapping, userId, orgId)

      expect(mockDb.auditEntry.create).toHaveBeenCalledTimes(2)
      expect(mockDb.auditEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId,
          action: 'IMPORT',
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
      ;(mockPrisma.leadContact.create as any).mockResolvedValue({})

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

    it('skips rows that duplicate an existing lead by email (case-insensitive)', async () => {
      const rows = [
        ['John', 'Doe', 'existing@example.com', ''],
        ['Jane', 'Smith', 'fresh@example.com', ''],
      ]

      // First row's email matches an active lead; second row does not.
      mockDb.lead.findFirst
        .mockResolvedValueOnce({ id: 'existing-lead' })
        .mockResolvedValueOnce(null)

      mockDb.lead.create.mockResolvedValue({ id: 'lead-jane' })
      mockDb.contact.create.mockResolvedValue({ id: 'contact-1' })
      mockDb.auditEntry.create.mockResolvedValue({})
      ;(mockPrisma.leadContact.create as any).mockResolvedValue({})

      const result = await importLeads(rows, headers, mapping, userId, orgId)

      expect(result.successCount).toBe(1)
      expect(result.skipCount).toBe(1)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].message).toContain('Duplicate lead')
      expect(result.errors[0].message).toContain('existing@example.com')
      // Only the non-duplicate row actually created a lead.
      expect(mockDb.lead.create).toHaveBeenCalledTimes(1)
    })

    it('falls back to name + company dedup when no email is provided', async () => {
      const rows = [
        ['John', 'Doe', '', 'Acme Corp'],
      ]

      // No email lookup runs because email is empty, so findFirst is only
      // called once for the name+company fallback path.
      mockDb.lead.findFirst.mockResolvedValueOnce({ id: 'existing-namebased' })

      const result = await importLeads(rows, headers, mapping, userId, orgId)

      expect(result.successCount).toBe(0)
      expect(result.skipCount).toBe(1)
      expect(result.errors[0].message).toContain('firstName + lastName + company')
      expect(mockDb.lead.create).not.toHaveBeenCalled()
    })
  })

  describe('previewImport', () => {
    const mapping = {
      'First Name': 'firstName',
      'Last Name': 'lastName',
      'Email': 'email',
    }

    it('returns mapped rows and full totalRows', () => {
      const csv = [
        'First Name,Last Name,Email',
        'John,Doe,john@example.com',
        'Jane,Smith,jane@example.com',
      ].join('\n')

      const preview = previewImport(csv, mapping)

      expect(preview.headers).toEqual(['First Name', 'Last Name', 'Email'])
      expect(preview.totalRows).toBe(2)
      expect(preview.previewRows).toHaveLength(2)
      expect(preview.previewRows[0]).toMatchObject({
        rowNumber: 2,
        valid: true,
        mapped: {
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
        },
      })
      expect(preview.validCount).toBe(2)
      expect(preview.invalidCount).toBe(0)
    })

    it('caps preview rows at 5 while reporting full totalRows', () => {
      const lines = ['First Name,Last Name,Email']
      for (let i = 0; i < 12; i++) {
        lines.push(`First${i},Last${i},user${i}@example.com`)
      }
      const preview = previewImport(lines.join('\n'), mapping)

      expect(preview.totalRows).toBe(12)
      expect(preview.previewRows).toHaveLength(5)
    })

    it('marks invalid rows and reports the failure reason', () => {
      const csv = [
        'First Name,Last Name,Email',
        ',Doe,john@example.com',
        'Jane,Smith,not-an-email',
      ].join('\n')

      const preview = previewImport(csv, mapping)

      expect(preview.validCount).toBe(0)
      expect(preview.invalidCount).toBe(2)
      expect(preview.previewRows[0]).toMatchObject({
        valid: false,
        error: expect.stringContaining('First name'),
      })
      expect(preview.previewRows[1]).toMatchObject({
        valid: false,
        error: expect.stringContaining('email'),
      })
    })

    it('throws when csv content is empty', () => {
      expect(() => previewImport('', mapping)).toThrow(/empty/i)
    })
  })

  describe('saveFieldMapping', () => {
    const validMapping = {
      'First Name': 'firstName',
      'Last Name': 'lastName',
    }

    it('persists a valid mapping and returns the created record', async () => {
      const now = new Date('2026-05-13T12:00:00Z')
      mockDb.fieldMapping.create.mockResolvedValue({
        id: 'mapping-1',
        name: 'My Salesforce export',
        mapping: validMapping,
        createdById: userId,
        createdAt: now,
      })

      const result = await saveFieldMapping(
        '  My Salesforce export  ',
        validMapping,
        userId,
        orgId,
      )

      expect(mockDb.fieldMapping.create).toHaveBeenCalledWith({
        data: {
          name: 'My Salesforce export',
          mapping: validMapping,
          createdById: userId,
        },
      })
      expect(result).toEqual({
        id: 'mapping-1',
        name: 'My Salesforce export',
        mapping: validMapping,
        createdById: userId,
        createdAt: now,
      })
    })

    it('rejects missing name', async () => {
      await expect(
        saveFieldMapping('   ', validMapping, userId, orgId),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

      expect(mockDb.fieldMapping.create).not.toHaveBeenCalled()
    })

    it('rejects a mapping with an unknown system field', async () => {
      await expect(
        saveFieldMapping(
          'Bad mapping',
          { Foo: 'notARealField' },
          userId,
          orgId,
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

      expect(mockDb.fieldMapping.create).not.toHaveBeenCalled()
    })

    it('rejects an empty mapping object', async () => {
      await expect(
        saveFieldMapping('Empty', {}, userId, orgId),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    })

    it('throws when userId or orgId is missing', async () => {
      await expect(
        saveFieldMapping('x', validMapping, '', orgId),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
      await expect(
        saveFieldMapping('x', validMapping, userId, ''),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    })
  })

  describe('getFieldMappings', () => {
    it('returns stored mappings ordered by createdAt desc', async () => {
      const newer = new Date('2026-05-13T12:00:00Z')
      const older = new Date('2026-05-12T12:00:00Z')
      mockDb.fieldMapping.findMany.mockResolvedValue([
        {
          id: 'm-1',
          name: 'Newer',
          mapping: { A: 'firstName' },
          createdById: userId,
          createdAt: newer,
        },
        {
          id: 'm-2',
          name: 'Older',
          mapping: { B: 'lastName' },
          createdById: userId,
          createdAt: older,
        },
      ])

      const result = await getFieldMappings(orgId)

      expect(mockDb.fieldMapping.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
      })
      expect(result).toEqual([
        {
          id: 'm-1',
          name: 'Newer',
          mapping: { A: 'firstName' },
          createdById: userId,
          createdAt: newer,
        },
        {
          id: 'm-2',
          name: 'Older',
          mapping: { B: 'lastName' },
          createdById: userId,
          createdAt: older,
        },
      ])
    })

    it('returns an empty array when no mappings exist', async () => {
      mockDb.fieldMapping.findMany.mockResolvedValue([])
      const result = await getFieldMappings(orgId)
      expect(result).toEqual([])
    })

    it('throws when orgId is missing', async () => {
      await expect(getFieldMappings('')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      })
    })
  })
})
