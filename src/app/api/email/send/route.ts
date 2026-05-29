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
  /**
   * When provided, the email is sent as a reply on an existing Gmail
   * thread. The Gmail API requires the threadId on the send payload to
   * stitch the message into the conversation (Requirement 7.3).
   */
  threadId: z.string().min(1).optional(),
})

/**
 * POST /api/email/send — Send an email to a lead with personalization tag replacement.
 *
 * Body: { leadId, subject, body, threadId? }
 *
 * Validates: Requirements 7.2, 7.3
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:write')

    const body = await request.json()
    const { leadId, subject, body: emailBody, threadId } = sendEmailBodySchema.parse(body)

    const result = await sendEmail(
      leadId,
      subject,
      emailBody,
      session.dbUser.id,
      session.organizationId,
      threadId,
    )

    return NextResponse.json({ data: result })
  } catch (error) {
    return errorResponse(error)
  }
}
