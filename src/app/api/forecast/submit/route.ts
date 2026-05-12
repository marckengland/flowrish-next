import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { submitForecast } from '@/server/services/forecast'
import { errorResponse } from '@/lib/errors'

const forecastSubmitSchema = z.object({
  period: z
    .string()
    .regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, 'Period must be in YYYY-MM format'),
  commitAmount: z.number().min(0, 'Commit amount must be non-negative'),
  notes: z.string().optional(),
})

/**
 * POST /api/forecast/submit — Submit a forecast commit for a period.
 *
 * Body: { period: "YYYY-MM", commitAmount: number, notes?: string }
 * Response: { data: { id } }
 *
 * Validates: Requirement 10.2
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'forecast:submit')

    const body = await request.json()
    const { period, commitAmount, notes } = forecastSubmitSchema.parse(body)

    const result = await submitForecast(
      session.dbUser.id,
      session.organizationId,
      period,
      commitAmount,
      notes,
    )

    return NextResponse.json({ data: result }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
