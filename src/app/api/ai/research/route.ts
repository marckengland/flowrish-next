import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { researchAccount } from '@/server/services/ai'
import { errorResponse } from '@/lib/errors'

const researchBodySchema = z.object({
  companyId: z.string().uuid('Invalid company ID'),
})

/**
 * POST /api/ai/research — Generate AI-powered account research for a company.
 *
 * Body: { companyId }
 *
 * Validates: Requirements 8.2
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:read')

    const body = await request.json()
    const { companyId } = researchBodySchema.parse(body)

    const result = await researchAccount(
      companyId,
      session.organizationId,
    )

    return NextResponse.json({ data: result })
  } catch (error) {
    return errorResponse(error)
  }
}
