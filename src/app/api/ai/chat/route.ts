import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSession } from '@/server/auth/session'
import { requireEntitlement } from '@/server/auth/entitlements'
import { chatMessage } from '@/server/services/ai'
import { errorResponse } from '@/lib/errors'

const chatBodySchema = z.object({
  message: z.string().min(1, 'Message is required').max(5000, 'Message too long'),
})

/**
 * POST /api/ai/chat — Send a message to the AI chatbot assistant.
 *
 * Body: { message }
 * No specific permission beyond session (any authenticated user).
 *
 * Validates: Requirements 8.3
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    await requireEntitlement(session.organizationId, 'ai')

    const body = await request.json()
    const { message } = chatBodySchema.parse(body)

    const result = await chatMessage(
      message,
      session.dbUser.id,
      session.organizationId,
    )

    return NextResponse.json({ data: result })
  } catch (error) {
    return errorResponse(error)
  }
}
