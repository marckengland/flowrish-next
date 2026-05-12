import { createTenantPrisma } from '@/server/db/middleware'
import type { LeadAccessFilter } from '@/server/services/access'

/**
 * Standard lead fields included in CSV export.
 */
const CSV_COLUMNS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'title',
  'dealValue',
  'currency',
  'leadStatus',
  'tier',
  'companyName',
  'companyIndustry',
  'country',
  'state',
  'linkedinUrl',
] as const

/**
 * Human-readable header labels for CSV columns.
 */
const CSV_HEADERS: Record<(typeof CSV_COLUMNS)[number], string> = {
  firstName: 'First Name',
  lastName: 'Last Name',
  email: 'Email',
  phone: 'Phone',
  title: 'Title',
  dealValue: 'Deal Value',
  currency: 'Currency',
  leadStatus: 'Lead Status',
  tier: 'Tier',
  companyName: 'Company Name',
  companyIndustry: 'Company Industry',
  country: 'Country',
  state: 'State',
  linkedinUrl: 'LinkedIn URL',
}

/**
 * Escapes a CSV field value per RFC 4180.
 *
 * Rules:
 * - If the value contains a comma, double-quote, or newline, wrap it in double quotes
 * - Double quotes within the value are escaped by doubling them ("")
 * - Null/undefined values become empty strings
 */
export function escapeCSVField(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }

  const str = String(value)

  // If the field contains a comma, double-quote, or newline, it must be quoted
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    // Escape double quotes by doubling them
    const escaped = str.replace(/"/g, '""')
    return `"${escaped}"`
  }

  return str
}

/**
 * Exports leads as a CSV string for the given organization.
 *
 * - Excludes soft-deleted leads (deletedAt != null)
 * - Applies optional RBAC access filter to scope exported data
 * - Includes a header row with human-readable column names
 * - Properly escapes values per RFC 4180
 *
 * Validates: Requirements 11.6
 *
 * @param orgId - Organization ID to scope the export
 * @param accessFilter - Optional RBAC filter (defaults to excluding soft-deleted only)
 * @returns CSV string with header row and data rows
 */
export async function exportLeads(
  orgId: string,
  accessFilter?: LeadAccessFilter,
): Promise<string> {
  const db = createTenantPrisma(orgId)

  // Build where clause: always exclude soft-deleted, apply access filter if provided
  const where: Record<string, unknown> = accessFilter
    ? { ...accessFilter }
    : { deletedAt: null }

  const leads = await db.lead.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      title: true,
      dealValue: true,
      currency: true,
      leadStatus: true,
      tier: true,
      companyName: true,
      companyIndustry: true,
      country: true,
      state: true,
      linkedinUrl: true,
    },
  })

  // Build header row
  const headerRow = CSV_COLUMNS.map((col) => escapeCSVField(CSV_HEADERS[col])).join(',')

  // Build data rows
  const dataRows = leads.map((lead) =>
    CSV_COLUMNS.map((col) => escapeCSVField(lead[col])).join(','),
  )

  // Combine header + data rows with CRLF line endings (RFC 4180)
  return [headerRow, ...dataRows].join('\r\n')
}
