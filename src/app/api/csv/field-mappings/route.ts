import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import {
  saveFieldMapping,
  getFieldMappings,
} from '@/server/services/csv-import'
import { errorResponse } from '@/lib/errors'
import { safeJsonBody } from '@/lib/validators/common'

/**
 * Schema for creating a reusable field mapping.
 *
 * The `mapping` object's values must be valid `ImportableField` names;
 * that enforcement happens inside `saveFieldMapping` so the same
 * validation is applied no matter which entry point creates a mapping.
 */
const saveMappingSchema = z.object({
  name: z.string().min(1).max(200),
  mapping: z.record(z.string(), z.string()),
})

/**
 * GET /api/csv/field-mappings — List saved CSV field mappings for the
 * caller's organization.
 *
 * Validates: Requirements 27.7
 */
export async function GET() {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:read')

    const mappings = await getFieldMappings(session.organizationId)

    return NextResponse.json({ data: mappings }, { status: 200 })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * POST /api/csv/field-mappings — Persist a reusable CSV field mapping.
 *
 * Body: { name: string, mapping: Record<csvHeader, systemField> }
 * Response: { data: SavedFieldMapping }
 *
 * Validates: Requirements 27.7
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:write')

    const rawBody = await request.json()
    const safeBody = safeJsonBody.parse(rawBody)
    const { name, mapping } = saveMappingSchema.parse(safeBody)

    const saved = await saveFieldMapping(
      name,
      mapping,
      session.dbUser.id,
      session.organizationId,
    )

    return NextResponse.json({ data: saved }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
