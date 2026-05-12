import { createTenantPrisma } from '@/server/db/middleware'
import { prisma } from '@/server/db/client'
import { AppError } from '@/lib/errors'
import { getOrCreateDefaultPipeline, createStageTransition } from '@/server/services/pipeline'
import { z } from 'zod'

/**
 * CSV Import Service
 *
 * Handles parsing CSV content, validating rows, creating companies/leads/contacts,
 * and logging audit entries for each imported lead.
 *
 * Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CSVParseResult {
  headers: string[]
  rows: string[][]
  totalRows: number
}

export interface FieldMapping {
  [csvHeader: string]: string // csvHeader -> systemField
}

export interface ImportError {
  row: number
  message: string
}

export interface ImportResult {
  successCount: number
  skipCount: number
  totalRows: number
  errors: ImportError[]
}

/**
 * System fields that can be mapped from CSV columns.
 */
export const IMPORTABLE_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'altEmail',
  'phone',
  'title',
  'description',
  'dealValue',
  'currency',
  'leadStatus',
  'tier',
  'linkedinUrl',
  'country',
  'state',
  'companyName',
  'companyIndustry',
  'companyWebsite',
  'stageId',
] as const

export type ImportableField = (typeof IMPORTABLE_FIELDS)[number]

/**
 * Zod schema for validating a single CSV row after mapping.
 * Required: firstName, lastName. stageId uses default if not provided.
 */
const csvRowSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  altEmail: z.string().email('Invalid alt email').optional().or(z.literal('')),
  phone: z.string().optional().or(z.literal('')),
  title: z.string().optional().or(z.literal('')),
  description: z.string().optional().or(z.literal('')),
  dealValue: z.string().optional().or(z.literal('')),
  currency: z.string().length(3).optional().or(z.literal('')),
  leadStatus: z.string().optional().or(z.literal('')),
  tier: z.string().optional().or(z.literal('')),
  linkedinUrl: z.string().url('Invalid LinkedIn URL').optional().or(z.literal('')),
  country: z.string().optional().or(z.literal('')),
  state: z.string().optional().or(z.literal('')),
  companyName: z.string().optional().or(z.literal('')),
  companyIndustry: z.string().optional().or(z.literal('')),
  companyWebsite: z.string().url('Invalid company website URL').optional().or(z.literal('')),
  stageId: z.string().optional().or(z.literal('')),
})

// ─── CSV Parsing ─────────────────────────────────────────────────────────────

/**
 * Parses a single CSV line handling quoted fields.
 * Handles:
 * - Comma-separated values
 * - Quoted fields (fields wrapped in double quotes)
 * - Escaped quotes within quoted fields (doubled double-quotes)
 * - Newlines within quoted fields are NOT supported (pre-split by line)
 */
function parseCSVLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (inQuotes) {
      if (char === '"') {
        // Check for escaped quote (doubled)
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++ // skip next quote
        } else {
          // End of quoted field
          inQuotes = false
        }
      } else {
        current += char
      }
    } else {
      if (char === '"') {
        inQuotes = true
      } else if (char === ',') {
        fields.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
  }

  // Push the last field
  fields.push(current.trim())

  return fields
}

/**
 * Parses CSV text content into headers and data rows.
 *
 * Uses a simple parser that splits by newlines and handles quoted fields.
 * Returns the headers array, data rows (excluding header), and total row count.
 *
 * @param csvContent - Raw CSV text content
 * @returns Parsed headers, rows, and total row count
 * @throws AppError if CSV is empty or has no data rows
 */
export function parseCSV(csvContent: string): CSVParseResult {
  if (!csvContent || csvContent.trim().length === 0) {
    throw new AppError('VALIDATION_ERROR', 'CSV content is empty', 400)
  }

  // Split by newlines (handle both \r\n and \n)
  const lines = csvContent
    .split(/\r?\n/)
    .filter(line => line.trim().length > 0)

  if (lines.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'CSV content is empty', 400)
  }

  if (lines.length < 2) {
    throw new AppError('VALIDATION_ERROR', 'CSV file contains no data rows', 400)
  }

  const headers = parseCSVLine(lines[0])
  const rows: string[][] = []

  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i])
    rows.push(row)
  }

  return {
    headers,
    rows,
    totalRows: rows.length,
  }
}

// ─── Import Logic ────────────────────────────────────────────────────────────

/**
 * Maps a raw CSV row to lead fields using the provided field mapping.
 *
 * @param row - Array of cell values from the CSV row
 * @param headers - Array of CSV column headers
 * @param mapping - Mapping from CSV header names to system field names
 * @returns Object with system field names as keys and cell values as values
 */
function mapRowToFields(
  row: string[],
  headers: string[],
  mapping: FieldMapping,
): Record<string, string> {
  const mapped: Record<string, string> = {}

  for (const [csvHeader, systemField] of Object.entries(mapping)) {
    const headerIndex = headers.indexOf(csvHeader)
    if (headerIndex !== -1 && headerIndex < row.length) {
      mapped[systemField] = (row[headerIndex] ?? '').trim()
    }
  }

  return mapped
}

/**
 * Imports leads from parsed CSV rows using the provided field mapping.
 *
 * For each valid row:
 * 1. Maps CSV columns to lead fields using the mapping
 * 2. Validates with Zod (requires firstName, lastName)
 * 3. Uses default pipeline's first stage if stageId not mapped
 * 4. Creates company if companyName is provided and no match exists
 * 5. Creates the lead with stage transition
 * 6. Links contacts if contact info is available
 * 7. Logs an audit entry for each imported lead
 *
 * Invalid rows are skipped with error details.
 *
 * @param rows - Parsed CSV data rows (array of cell arrays)
 * @param headers - CSV column headers
 * @param mapping - Field mapping (csvHeader -> systemField)
 * @param userId - The importing user's ID
 * @param orgId - The organization ID
 * @returns Import results with success/skip counts and errors
 */
export async function importLeads(
  rows: string[][],
  headers: string[],
  mapping: FieldMapping,
  userId: string,
  orgId: string,
): Promise<ImportResult> {
  if (!userId) {
    throw new AppError('VALIDATION_ERROR', 'User ID is required', 400)
  }
  if (!orgId) {
    throw new AppError('VALIDATION_ERROR', 'Organization ID is required', 400)
  }

  const db = createTenantPrisma(orgId)
  const totalRows = rows.length
  let successCount = 0
  const errors: ImportError[] = []

  // Ensure default pipeline exists and get the first stage as fallback
  const pipeline = await getOrCreateDefaultPipeline(orgId)
  const defaultStageId = pipeline.stages[0]?.id

  if (!defaultStageId) {
    throw new AppError(
      'PIPELINE_ERROR',
      'No stages found in the default pipeline',
      500,
    )
  }

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2 // 1-indexed + header row offset
    const row = rows[i]

    try {
      // Map CSV columns to system fields
      const mapped = mapRowToFields(row, headers, mapping)

      // Validate the mapped row
      const parseResult = csvRowSchema.safeParse(mapped)

      if (!parseResult.success) {
        const firstError = parseResult.error.errors[0]
        errors.push({
          row: rowNumber,
          message: firstError?.message ?? 'Validation failed',
        })
        continue
      }

      const data = parseResult.data

      // Check required fields (firstName, lastName)
      if (!data.firstName || data.firstName.trim().length === 0) {
        errors.push({ row: rowNumber, message: 'First name is required' })
        continue
      }
      if (!data.lastName || data.lastName.trim().length === 0) {
        errors.push({ row: rowNumber, message: 'Last name is required' })
        continue
      }

      // Resolve stageId: use mapped value or default to first stage
      let stageId = defaultStageId
      if (data.stageId && data.stageId.trim().length > 0) {
        // Verify the stage exists within the org
        const stage = await db.stage.findFirst({
          where: { id: data.stageId.trim() },
        })
        if (stage) {
          stageId = stage.id
        } else {
          errors.push({
            row: rowNumber,
            message: `Invalid stage ID: "${data.stageId}"`,
          })
          continue
        }
      }

      // Parse deal value if provided
      let dealValue: number | null = null
      if (data.dealValue && data.dealValue.trim().length > 0) {
        const parsed = parseFloat(data.dealValue)
        if (isNaN(parsed) || parsed < 0) {
          errors.push({ row: rowNumber, message: 'Invalid deal value' })
          continue
        }
        dealValue = parsed
      }

      // Create company if companyName is provided
      let companyId: string | null = null
      const companyName = data.companyName?.trim() || null

      if (companyName) {
        // Check if company already exists (case-insensitive match)
        const existingCompany = await db.company.findFirst({
          where: {
            name: { equals: companyName, mode: 'insensitive' as any },
          },
        })

        if (existingCompany) {
          companyId = existingCompany.id
        } else {
          // Create new company
          const newCompany = await db.company.create({
            data: {
              name: companyName,
              industry: data.companyIndustry?.trim() || null,
              website: data.companyWebsite?.trim() || null,
            } as any,
          })
          companyId = newCompany.id
        }
      }

      // Create the lead
      const lead = await db.lead.create({
        data: {
          firstName: data.firstName.trim(),
          lastName: data.lastName.trim(),
          email: data.email?.trim() || null,
          altEmail: data.altEmail?.trim() || null,
          phone: data.phone?.trim() || null,
          title: data.title?.trim() || null,
          description: data.description?.trim() || null,
          dealValue,
          currency: data.currency?.trim() || 'USD',
          leadStatus: data.leadStatus?.trim() || 'NEW',
          tier: data.tier?.trim() || null,
          linkedinUrl: data.linkedinUrl?.trim() || null,
          country: data.country?.trim() || null,
          state: data.state?.trim() || null,
          companyName,
          companyIndustry: data.companyIndustry?.trim() || null,
          companyWebsite: data.companyWebsite?.trim() || null,
          stageId,
          companyId,
        } as any,
      })

      // Create initial stage transition
      await createStageTransition(lead.id, null, stageId, userId, db)

      // Link contact if email is provided
      if (data.email && data.email.trim().length > 0) {
        const contact = await db.contact.create({
          data: {
            firstName: data.firstName.trim(),
            lastName: data.lastName.trim(),
            email: data.email.trim(),
            phone: data.phone?.trim() || null,
            jobTitle: data.title?.trim() || null,
            companyId,
          } as any,
        })

        // Link contact to lead
        await prisma.leadContact.create({
          data: {
            leadId: lead.id,
            contactId: contact.id,
          },
        })
      }

      // Log audit entry for the imported lead
      try {
        await db.auditEntry.create({
          data: {
            userId,
            action: 'CREATE',
            entityType: 'Lead',
            entityId: lead.id,
            changes: null,
          } as any,
        })
      } catch {
        // Audit failure should not block import
      }

      successCount++
    } catch (error) {
      // Unexpected error for this row — skip it
      const message =
        error instanceof Error ? error.message : 'Unexpected error'
      errors.push({ row: rowNumber, message })
    }
  }

  const skipCount = totalRows - successCount

  return {
    successCount,
    skipCount,
    totalRows,
    errors,
  }
}
