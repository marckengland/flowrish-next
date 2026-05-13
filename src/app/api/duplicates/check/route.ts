import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { checkDuplicates } from '@/server/services/duplicates'
import { errorResponse } from '@/lib/errors'
import { z } from 'zod'

const checkDuplicatesSchema = z.object({
  contactEmail: z.string().email('Invalid email address').optional(),
  companyName: z.string().min(1, 'Company name must not be empty').optional(),
}).refine(
  (data) => data.contactEmail || data.companyName,
  { message: 'At least one of contactEmail or companyName is required' },
)

/**
 * POST /api/duplicates/check — Check for potential duplicate leads.
 *
 * Body: { contactEmail?, companyName? } (at least one required)
 *
 * Returns matching leads with leadId, leadName, matchType, and matchValue.
 *
 * Validates: Requirement 27.1
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:read')

    const body = await request.json()
    const { contactEmail, companyName } = checkDuplicatesSchema.parse(body)

    const matches = await checkDuplicates(
      contactEmail,
      companyName,
      session.organizationId,
    )

    return NextResponse.json({ data: matches })
  } catch (error) {
    return errorResponse(error)
  }
}
