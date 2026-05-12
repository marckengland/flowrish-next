import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { sendEmail } from '@/server/services/email'
import { errorResponse } from '@/lib/errors'

const sendEmailBodySchema = z.object({
  leadId: z.string().uuid('Invalid lead ID'),
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Body is required'),
})

/**
 * POST /api/email/send — Send an email to a lead with personalization tag replacement.
 *
 * Body: { leadId, subject, body }
 *
 * Validates: Requirements 7.2
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:write')

    const body = await request.json()
    const { leadId, subject, body: emailBody } = sendEmailBodySchema.parse(body)

    const result = await sendEmail(
      leadId,
      subject,
      emailBody,
      session.dbUser.id,
      session.organizationId,
    )

    return NextResponse.json({ data: result })
  } catch (error) {
    return errorResponse(error)
  }
}
