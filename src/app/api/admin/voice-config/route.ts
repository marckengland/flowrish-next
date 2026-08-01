import { NextRequest, NextResponse } from 'next/server'

import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import {
  getVoiceConfigView,
  saveTwilioConfig,
  deleteVoiceConfig,
} from '@/server/services/voice'
import { errorResponse } from '@/lib/errors'

/**
 * GET /api/admin/voice-config — the org's Twilio config (secret masked).
 */
export async function GET() {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'admin:settings')
    const config = await getVoiceConfigView(session.organizationId)
    return NextResponse.json({ config })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * PUT /api/admin/voice-config — save the org's Twilio credentials.
 * The API secret is encrypted at rest; leave it blank to keep the stored one.
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'admin:settings')

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const config = await saveTwilioConfig(session.organizationId, {
      twilioAccountSid: String(body.twilioAccountSid ?? ''),
      twilioApiKeySid: String(body.twilioApiKeySid ?? ''),
      twilioApiKeySecret:
        typeof body.twilioApiKeySecret === 'string'
          ? body.twilioApiKeySecret
          : undefined,
      twilioTwimlAppSid: String(body.twilioTwimlAppSid ?? ''),
      twilioCallerId: String(body.twilioCallerId ?? ''),
    })

    return NextResponse.json({ config })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * DELETE /api/admin/voice-config — remove the org's stored credentials.
 */
export async function DELETE() {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'admin:settings')
    await deleteVoiceConfig(session.organizationId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse(error)
  }
}
