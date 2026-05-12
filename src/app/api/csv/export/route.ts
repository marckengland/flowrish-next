import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { getLeadAccessFilter } from '@/server/services/access'
import { exportLeads } from '@/server/services/csv-export'
import { errorResponse } from '@/lib/errors'

/**
 * GET /api/csv/export — Export leads as a CSV file.
 *
 * Returns a CSV response with:
 * - Content-Type: text/csv; charset=utf-8
 * - Content-Disposition: attachment; filename="leads-YYYY-MM-DD.csv"
 *
 * The export:
 * - Excludes soft-deleted leads (handled by access filter)
 * - Applies RBAC access filter based on the caller's role
 * - Is scoped to the caller's organization via tenant isolation
 *
 * Validates: Requirement 11.6
 */
export async function GET() {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:read')

    const accessFilter = await getLeadAccessFilter(session.dbUser)
    const csv = await exportLeads(session.organizationId, accessFilter)

    const filename = `leads-${new Date().toISOString().slice(0, 10)}.csv`

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
