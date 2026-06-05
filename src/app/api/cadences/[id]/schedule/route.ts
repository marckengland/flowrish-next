import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import {
  deleteCadenceSchedule,
  getCadenceSchedule,
  setCadenceSchedule,
} from '@/server/services/cadences'
import { errorResponse } from '@/lib/errors'

const paramsSchema = z.object({
  id: z.string().uuid('Invalid cadence ID'),
})

/**
 * Schema for the PUT body — mirrors `CadenceScheduleInput` in the
 * service layer. The service performs additional cross-field
 * validation (start < end, valid timezone) which we keep authoritative
 * there to avoid drift between API and direct service callers.
 */
const scheduleBodySchema = z.object({
  name: z.string().min(1).max(80).optional(),
  daysOfWeek: z
    .array(z.number().int().min(0).max(6))
    .min(1, 'Pick at least one day'),
  startTimeMinutes: z.number().int().min(0).max(1439),
  endTimeMinutes: z.number().int().min(0).max(1439),
  timezone: z.string().min(1).max(64),
})

/**
 * GET /api/cadences/[id]/schedule — returns the cadence's send-window
 * schedule, or `null` when no schedule has been configured (the
 * runner sends immediately in that case).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'cadences:read')

    const { id } = paramsSchema.parse(await params)

    const schedule = await getCadenceSchedule(id, session.organizationId)

    return NextResponse.json({ data: schedule })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * PUT /api/cadences/[id]/schedule — creates or updates the cadence
 * schedule (one-to-one). The runner consults this record before
 * firing each step, sleeping enrollments to the next allowed window
 * when the current moment falls outside the configured days/hours.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'cadences:manage')

    const { id } = paramsSchema.parse(await params)
    const body = scheduleBodySchema.parse(await request.json())

    const schedule = await setCadenceSchedule(
      id,
      body,
      session.organizationId,
    )

    return NextResponse.json({ data: schedule })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * DELETE /api/cadences/[id]/schedule — removes the schedule. After
 * deletion the runner resumes immediate execution (no time-of-day
 * gating).
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'cadences:manage')

    const { id } = paramsSchema.parse(await params)

    await deleteCadenceSchedule(id, session.organizationId)

    return NextResponse.json({ data: { deleted: true } })
  } catch (error) {
    return errorResponse(error)
  }
}
