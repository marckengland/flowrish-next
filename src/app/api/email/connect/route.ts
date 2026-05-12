import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { connectGmail } from '@/server/services/email'
import { errorResponse } from '@/lib/errors'

const connectBodySchema = z.object({
  code: z.string().min(1, 'OAuth authorization code is required'),
})

/**
 * POST /api/email/connect — Exchange Gmail OAuth code for tokens and store encrypted.
 *
 * Body: { code }
 *
 * Validates: Requirements 7.1
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:write')

    const body = await request.json()
    const { code } = connectBodySchema.parse(body)

    const result = await connectGmail(code, session.dbUser.id, session.organizationId)

    return NextResponse.json({ data: result }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
