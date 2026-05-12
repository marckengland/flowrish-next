import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import {
  previewImport,
  type FieldMapping,
} from '@/server/services/csv-import'
import { errorResponse } from '@/lib/errors'
import { safeJsonBody } from '@/lib/validators/common'

/**
 * Schema for the CSV preview request body.
 *
 * Same shape as `/api/csv/import`, but the request is pure read-only —
 * no leads are persisted. Used by the import wizard to show the user
 * what their mapping would produce before they commit.
 */
const csvPreviewSchema = z.object({
  csvContent: z.string().min(1, 'CSV content is required'),
  mapping: z.record(z.string(), z.string()),
})

/**
 * POST /api/csv/preview — Preview a CSV import under a given mapping.
 *
 * Body: { csvContent: string, mapping: Record<csvHeader, systemField> }
 * Response: { data: ImportPreview }
 *
 * Returns the first few rows mapped and validated, along with the full
 * `totalRows` count. No persistent side effects.
 *
 * Validates: Requirements 11.1, 11.2
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:write')

    const rawBody = await request.json()
    const safeBody = safeJsonBody.parse(rawBody)
    const { csvContent, mapping } = csvPreviewSchema.parse(safeBody)

    const preview = previewImport(csvContent, mapping as FieldMapping)

    return NextResponse.json({ data: preview }, { status: 200 })
  } catch (error) {
    return errorResponse(error)
  }
}
