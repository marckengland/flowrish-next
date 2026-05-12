import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { search, type SearchFilters } from '@/server/services/search'
import { searchQuerySchema } from '@/lib/validators/search'
import { errorResponse } from '@/lib/errors'

/**
 * GET /api/search — Full-text search across leads, contacts, and companies.
 *
 * Query params:
 *   - q (required): Search query string
 *   - entityType? : Restrict to "Lead" | "Contact" | "Company"
 *   - dateFrom?   : ISO 8601 lower bound on createdAt (inclusive)
 *   - dateTo?     : ISO 8601 upper bound on createdAt (inclusive)
 *   - assignedUserId? : UUID filter for Lead results
 *
 * Response: { data: SearchResult[] }
 *
 * Results are scoped to the caller's organization and exclude soft-deleted leads.
 *
 * Validates: Requirements 12.2, 12.4
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession()

    const { searchParams } = request.nextUrl

    const parsed = searchQuerySchema.parse({
      q: searchParams.get('q') ?? undefined,
      entityType: searchParams.get('entityType') ?? undefined,
      dateFrom: searchParams.get('dateFrom') ?? undefined,
      dateTo: searchParams.get('dateTo') ?? undefined,
      assignedUserId: searchParams.get('assignedUserId') ?? undefined,
    })

    const filters: SearchFilters = {}
    if (parsed.entityType) filters.entityType = parsed.entityType
    if (parsed.assignedUserId) filters.assignedUserId = parsed.assignedUserId
    if (parsed.dateFrom || parsed.dateTo) {
      filters.dateRange = {}
      if (parsed.dateFrom) filters.dateRange.from = new Date(parsed.dateFrom)
      if (parsed.dateTo) filters.dateRange.to = new Date(parsed.dateTo)
    }

    const results = await search(parsed.q, session.organizationId, filters)

    return NextResponse.json({ data: results })
  } catch (error) {
    return errorResponse(error)
  }
}
