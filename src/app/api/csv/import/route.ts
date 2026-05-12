import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import {
  parseCSV,
  importLeads,
  type FieldMapping,
} from '@/server/services/csv-import'
import { errorResponse, AppError } from '@/lib/errors'
import { safeJsonBody } from '@/lib/validators/common'

/**
 * Schema for the CSV import request body.
 *
 * - csvContent: Raw CSV text content (headers + data rows)
 * - mapping: Object mapping CSV header names to system field names
 *            (e.g. { "First Name": "firstName", "Company": "companyName" })
 */
const csvImportSchema = z.object({
  csvContent: z.string().min(1, 'CSV content is required'),
  mapping: z.record(z.string(), z.string()),
})

/**
 * POST /api/csv/import — Import leads from a CSV payload.
 *
 * Body: { csvContent: string, mapping: Record<csvHeader, systemField> }
 * Response: { data: { successCount, skipCount, totalRows, errors } }
 *
 * The request body is expected to be JSON. The raw CSV text is passed
 * through `csvContent` — this keeps the route simple and works from both
 * server-rendered forms (which pre-read the File) and fetch-based clients.
 *
 * Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:write')

    // Parse and validate the JSON body (rejects prototype pollution)
    const rawBody = await request.json()
    const safeBody = safeJsonBody.parse(rawBody)
    const { csvContent, mapping } = csvImportSchema.parse(safeBody)

    // Parse CSV into headers + rows (throws AppError on malformed/empty input)
    const parsed = parseCSV(csvContent)

    // Run the import with the provided field mapping
    const result = await importLeads(
      parsed.rows,
      parsed.headers,
      mapping as FieldMapping,
      session.dbUser.id,
      session.organizationId,
    )

    // Sanity check: successCount + skipCount must equal totalRows
    if (result.successCount + result.skipCount !== result.totalRows) {
      throw new AppError(
        'INTERNAL_ERROR',
        'Import row counts do not reconcile',
        500,
      )
    }

    return NextResponse.json({ data: result }, { status: 200 })
  } catch (error) {
    return errorResponse(error)
  }
}
