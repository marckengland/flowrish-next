import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for the CSV export service.
 *
 * Tests cover:
 * - Exporting leads as CSV with proper header row
 * - Excluding soft-deleted leads
 * - RFC 4180 escaping (commas, quotes, newlines)
 * - Applying RBAC access filter
 * - Handling empty result sets
 *
 * **Validates: Requirements 11.6**
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockDb = {
  lead: {
    findMany: vi.fn(),
  },
}

vi.mock('@/server/db/middleware', () => ({
  createTenantPrisma: vi.fn(() => mockDb),
  TENANT_SCOPED_MODELS: ['Lead'],
}))

vi.mock('@/generated/prisma', () => ({
  PrismaClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: vi.fn(),
}))

import { exportLeads, escapeCSVField } from '@/server/services/csv-export'

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CSV Export Service', () => {
  const orgId = '550e8400-e29b-41d4-a716-446655440000'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('escapeCSVField', () => {
    it('returns empty string for null', () => {
      expect(escapeCSVField(null)).toBe('')
    })

    it('returns empty string for undefined', () => {
      expect(escapeCSVField(undefined)).toBe('')
    })

    it('returns plain string when no special characters', () => {
      expect(escapeCSVField('John')).toBe('John')
    })

    it('wraps value in quotes when it contains a comma', () => {
      expect(escapeCSVField('Acme, Inc.')).toBe('"Acme, Inc."')
    })

    it('wraps value in quotes and doubles internal quotes', () => {
      expect(escapeCSVField('She said "hello"')).toBe('"She said ""hello"""')
    })

    it('wraps value in quotes when it contains a newline', () => {
      expect(escapeCSVField('Line 1\nLine 2')).toBe('"Line 1\nLine 2"')
    })

    it('wraps value in quotes when it contains a carriage return', () => {
      expect(escapeCSVField('Line 1\rLine 2')).toBe('"Line 1\rLine 2"')
    })

    it('handles value with both commas and quotes', () => {
      expect(escapeCSVField('"Hello", world')).toBe('"""Hello"", world"')
    })

    it('converts numbers to strings', () => {
      expect(escapeCSVField(50000)).toBe('50000')
    })
  })

  describe('exportLeads', () => {
    it('returns CSV with header row and data rows', async () => {
      mockDb.lead.findMany.mockResolvedValue([
        {
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          phone: '+1234567890',
          title: 'CEO',
          dealValue: 50000,
          currency: 'USD',
          leadStatus: 'Open',
          tier: 'Enterprise',
          companyName: 'Acme Corp',
          companyIndustry: 'Technology',
          country: 'US',
          state: 'CA',
          linkedinUrl: 'https://linkedin.com/in/johndoe',
        },
      ])

      const csv = await exportLeads(orgId)

      const lines = csv.split('\r\n')
      expect(lines[0]).toBe(
        'First Name,Last Name,Email,Phone,Title,Deal Value,Currency,Lead Status,Tier,Company Name,Company Industry,Country,State,LinkedIn URL',
      )
      expect(lines[1]).toBe(
        'John,Doe,john@example.com,+1234567890,CEO,50000,USD,Open,Enterprise,Acme Corp,Technology,US,CA,https://linkedin.com/in/johndoe',
      )
    })

    it('excludes soft-deleted leads via where clause', async () => {
      mockDb.lead.findMany.mockResolvedValue([])

      await exportLeads(orgId)

      expect(mockDb.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null },
        }),
      )
    })

    it('applies RBAC access filter when provided', async () => {
      mockDb.lead.findMany.mockResolvedValue([])

      const accessFilter = { deletedAt: null as null, assignedUserId: 'user-123' }
      await exportLeads(orgId, accessFilter)

      expect(mockDb.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null, assignedUserId: 'user-123' },
        }),
      )
    })

    it('returns only header row when no leads exist', async () => {
      mockDb.lead.findMany.mockResolvedValue([])

      const csv = await exportLeads(orgId)

      const lines = csv.split('\r\n')
      expect(lines).toHaveLength(1)
      expect(lines[0]).toBe(
        'First Name,Last Name,Email,Phone,Title,Deal Value,Currency,Lead Status,Tier,Company Name,Company Industry,Country,State,LinkedIn URL',
      )
    })

    it('handles null fields as empty strings in CSV', async () => {
      mockDb.lead.findMany.mockResolvedValue([
        {
          firstName: 'Jane',
          lastName: 'Smith',
          email: null,
          phone: null,
          title: null,
          dealValue: null,
          currency: 'USD',
          leadStatus: 'New',
          tier: null,
          companyName: null,
          companyIndustry: null,
          country: null,
          state: null,
          linkedinUrl: null,
        },
      ])

      const csv = await exportLeads(orgId)

      const lines = csv.split('\r\n')
      expect(lines[1]).toBe('Jane,Smith,,,,,USD,New,,,,,,' )
    })

    it('escapes values containing commas per RFC 4180', async () => {
      mockDb.lead.findMany.mockResolvedValue([
        {
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          phone: null,
          title: null,
          dealValue: null,
          currency: 'USD',
          leadStatus: 'Open',
          tier: null,
          companyName: 'Acme, Inc.',
          companyIndustry: null,
          country: null,
          state: null,
          linkedinUrl: null,
        },
      ])

      const csv = await exportLeads(orgId)

      const lines = csv.split('\r\n')
      // companyName should be quoted because it contains a comma
      expect(lines[1]).toContain('"Acme, Inc."')
    })

    it('escapes values containing double quotes per RFC 4180', async () => {
      mockDb.lead.findMany.mockResolvedValue([
        {
          firstName: 'John',
          lastName: 'Doe',
          email: null,
          phone: null,
          title: 'VP of "Sales"',
          dealValue: null,
          currency: 'USD',
          leadStatus: 'Open',
          tier: null,
          companyName: null,
          companyIndustry: null,
          country: null,
          state: null,
          linkedinUrl: null,
        },
      ])

      const csv = await exportLeads(orgId)

      const lines = csv.split('\r\n')
      expect(lines[1]).toContain('"VP of ""Sales"""')
    })

    it('exports multiple leads as separate rows', async () => {
      mockDb.lead.findMany.mockResolvedValue([
        {
          firstName: 'Alice',
          lastName: 'A',
          email: 'alice@test.com',
          phone: null,
          title: null,
          dealValue: 10000,
          currency: 'USD',
          leadStatus: 'Open',
          tier: null,
          companyName: null,
          companyIndustry: null,
          country: null,
          state: null,
          linkedinUrl: null,
        },
        {
          firstName: 'Bob',
          lastName: 'B',
          email: 'bob@test.com',
          phone: null,
          title: null,
          dealValue: 20000,
          currency: 'EUR',
          leadStatus: 'Qualified',
          tier: null,
          companyName: null,
          companyIndustry: null,
          country: null,
          state: null,
          linkedinUrl: null,
        },
      ])

      const csv = await exportLeads(orgId)

      const lines = csv.split('\r\n')
      expect(lines).toHaveLength(3) // header + 2 data rows
      expect(lines[1]).toContain('Alice')
      expect(lines[2]).toContain('Bob')
    })
  })
})
