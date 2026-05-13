import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { errorResponse } from '@/lib/errors'
import { getConversionRates } from '@/server/services/dashboard'

/**
 * GET /api/dashboard/conversion-rates — Stage-to-stage conversion rates.
 *
 * Query params:
 *   - from (optional): ISO date string for range start
 *   - to (optional): ISO date string for range end
 *
 * Validates: Requirements 28.2, 28.6
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession()

    const { searchParams } = request.nextUrl
    const from = searchParams.get('from')
    const to = searchParams.get('to')

    const dateRange = {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    }

    const data = await getConversionRates(session.organizationId, dateRange)

    return NextResponse.json({ data })
  } catch (error) {
    return errorResponse(error)
  }
}
