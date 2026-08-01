import { NextRequest, NextResponse } from 'next/server'

import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { prisma } from '@/server/db/client'
import { AppError, errorResponse } from '@/lib/errors'

/** Voice providers the org can select as its preferred calling backend. */
const VOICE_PROVIDERS = [
  'twilio',
  'telnyx',
  'signalwire',
  'plivo',
  'bandwidth',
] as const

type VoiceProvider = (typeof VOICE_PROVIDERS)[number]

/**
 * GET /api/admin/voice-provider — the org's selected voice provider.
 */
export async function GET() {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'admin:settings')

    const org = await prisma.organization.findUnique({
      where: { id: session.organizationId },
      select: { voiceProvider: true },
    })

    return NextResponse.json({ provider: org?.voiceProvider ?? null })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * PATCH /api/admin/voice-provider — set (or clear) the org's voice provider.
 *
 * Body: { provider: 'twilio' | 'telnyx' | 'signalwire' | 'plivo' | 'bandwidth' | null }
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'admin:settings')

    const body = (await request.json().catch(() => ({}))) as {
      provider?: unknown
    }
    const provider = body.provider

    if (
      provider !== null &&
      !(
        typeof provider === 'string' &&
        (VOICE_PROVIDERS as readonly string[]).includes(provider)
      )
    ) {
      throw new AppError(
        'VALIDATION_ERROR',
        `provider must be null or one of: ${VOICE_PROVIDERS.join(', ')}`,
        400,
      )
    }

    await prisma.organization.update({
      where: { id: session.organizationId },
      data: { voiceProvider: (provider as VoiceProvider | null) ?? null },
    })

    return NextResponse.json({ provider: provider ?? null })
  } catch (error) {
    return errorResponse(error)
  }
}
