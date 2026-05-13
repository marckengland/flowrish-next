import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { errorResponse } from '@/lib/errors'
import { getStageDuration } from '@/server/services/dashboard'

/**
 * GET /api/dashboard/stage-duration — Average time in each stage.
 *
 * Query params:
 *   - from (optional): ISO date string for range start
 *   - to (optional): ISO date string for range end
 *
 * Validates: Requirements 28.3, 28.6
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

    const data = await getStageDuration(session.organizationId, dateRange)

    return NextResponse.json({ data })
  } catch (error) {
    return errorResponse(error)
  }
}
