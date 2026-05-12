import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import {
  parseCSV,
  importLeads,
  getFieldMappings,
  type FieldMapping,
} from '@/server/services/csv-import'
import { errorResponse, AppError } from '@/lib/errors'
import { safeJsonBody } from '@/lib/validators/common'

/**
 * Schema for the CSV import request body.
 *
 * Either an inline `mapping` object is provided, or a `fieldMappingId`
 * referencing a previously saved `FieldMapping` record. If both are
 * supplied the inline `mapping` wins so ad-hoc imports can override a
 * saved template on the fly.
 */
const csvImportSchema = z
  .object({
    csvContent: z.string().min(1, 'CSV content is required'),
    mapping: z.record(z.string(), z.string()).optional(),
    fieldMappingId: z.string().uuid().optional(),
  })
  .refine((b) => b.mapping !== undefined || b.fieldMappingId !== undefined, {
    message: 'Either "mapping" or "fieldMappingId" is required',
  })

/**
 * POST /api/csv/import — Import leads from a CSV payload.
 *
 * Body: {
 *   csvContent: string,
 *   mapping?: Record<csvHeader, systemField>,
 *   fieldMappingId?: string   // Reuse a saved FieldMapping instead of inline mapping
 * }
 * Response: { data: { successCount, skipCount, totalRows, errors } }
 *
 * The request body is expected to be JSON. The raw CSV text is passed
 * through `csvContent` — this keeps the route simple and works from both
 * server-rendered forms (which pre-read the File) and fetch-based clients.
 *
 * Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 27.7
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:write')

    // Parse and validate the JSON body (rejects prototype pollution)
    const rawBody = await request.json()
    const safeBody = safeJsonBody.parse(rawBody)
    const { csvContent, mapping, fieldMappingId } = csvImportSchema.parse(
      safeBody,
    )

    // Resolve the effective field mapping: inline takes precedence, else
    // look up the saved mapping by ID within the caller's organization.
    let effectiveMapping: FieldMapping
    if (mapping) {
      effectiveMapping = mapping as FieldMapping
    } else {
      const saved = await getFieldMappings(session.organizationId)
      const match = saved.find((m) => m.id === fieldMappingId)
      if (!match) {
        throw new AppError(
          'NOT_FOUND',
          `Field mapping "${fieldMappingId}" not found`,
          404,
        )
      }
      effectiveMapping = match.mapping
    }

    // Parse CSV into headers + rows (throws AppError on malformed/empty input)
    const parsed = parseCSV(csvContent)

    // Run the import with the resolved field mapping
    const result = await importLeads(
      parsed.rows,
      parsed.headers,
      effectiveMapping,
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
