import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/server/db/client'
import { errorResponse } from '@/lib/errors'
import {
  sendTransactionalEmail,
  formatWaitlistConfirmationEmail,
} from '@/server/services/transactional-email'

/**
 * POST /api/waitlist — public private-beta email capture.
 *
 * Rate-limited by middleware alongside all `/api/*` routes. Privacy: duplicate
 * submissions return the SAME success shape as a fresh signup (we never reveal
 * whether an email was already on the list). Confirmation email is best-effort
 * and never fails the request.
 */

const waitlistSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  name: z.string().trim().max(100, 'Name is too long').optional(),
  source: z.enum(['landing', 'public_demo']).default('landing'),
})

export async function POST(request: NextRequest) {
  try {
    // Contact capture remains available when signup is open.
    const body = await request.json()
    const { email, name: rawName, source } = waitlistSchema.parse(body)
    const name = rawName && rawName.length > 0 ? rawName : undefined

    // Insert if new; no-op (and don't leak) if the email already exists.
    const existing = await prisma.waitlist.findUnique({
      where: { email },
      select: { id: true },
    })

    if (!existing) {
      await prisma.waitlist.create({
        data: { email, name, source },
      })

      // Best-effort confirmation — never block the response on delivery.
      try {
        const { subject, html } = formatWaitlistConfirmationEmail(name)
        await sendTransactionalEmail({ to: email, subject, html })
      } catch {
        // Swallow — email is non-critical.
      }
    }

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    return errorResponse(error)
  }
}
