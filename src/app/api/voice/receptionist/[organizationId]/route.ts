import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/server/db/client'
import { getTwilioWebhookContext } from '@/server/services/voice'
import { handleReceptionistCall } from '@/server/services/receptionist'
import { validateTwilioSignature } from '@/lib/twilio-signature'
import { gatherTwiml } from '@/lib/receptionist'

export const runtime = 'nodejs'
export const maxDuration = 30

function xml(body: string, status = 200) {
  return new NextResponse(body, { status, headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest, context: { params: Promise<{ organizationId: string }> }) {
  try {
    const { organizationId } = await context.params
    if (!z.string().uuid().safeParse(organizationId).success) return xml('<Response><Reject/></Response>', 400)
    const raw = await request.text()
    if (raw.length > 16000 || !request.headers.get('content-type')?.includes('application/x-www-form-urlencoded')) return xml('<Response><Reject/></Response>', 400)
    const form = new URLSearchParams(raw)
    const params: Record<string, string> = {}
    for (const [key, value] of form) {
      if (key in params) return xml('<Response><Reject/></Response>', 400)
      params[key] = value
    }
    const [voice, credentials] = await Promise.all([
      prisma.voiceConfig.findUnique({ where: { organizationId }, select: { twilioAccountSid: true, twilioCallerId: true } }),
      getTwilioWebhookContext(organizationId),
    ])
    const proto = request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', '')
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? request.nextUrl.host
    const signedUrl = `${proto}://${host}${request.nextUrl.pathname}${request.nextUrl.search}`
    if (!credentials.authToken || !voice?.twilioAccountSid || params.AccountSid !== voice.twilioAccountSid || params.To !== voice.twilioCallerId || !validateTwilioSignature(credentials.authToken, signedUrl, params, request.headers.get('x-twilio-signature'))) return xml('<Response><Reject/></Response>', 403)
    const rawTurn = request.nextUrl.searchParams.get('turn') ?? '0'
    if (params.Direction !== 'inbound' || !/^CA[a-f0-9]{32}$/i.test(params.CallSid ?? '') || !/^\d{1,2}$/.test(rawTurn) || Number(rawTurn) > 14) return xml('<Response><Reject/></Response>', 400)
    return xml(await handleReceptionistCall(organizationId, {
      callSid: params.CallSid, from: params.From ?? '', turn: Number(rawTurn),
      speech: params.SpeechResult ?? '', digits: params.Digits ?? '', actionPath: request.nextUrl.pathname,
    }))
  } catch {
    return xml(gatherTwiml('We could not finish taking your callback request. Please call again during business hours. Goodbye.', '', true))
  }
}
