import type { NextRequest } from 'next/server'
import { PILOT_COOKIE_NAME, pilotSessionSchema } from '@/lib/pilot-onboarding'
import {
  pilotCookieOptions,
  pilotResponse,
  requirePilotOrigin,
} from '@/server/services/pilot-http'
import { readWebsiteBody } from '@/server/services/website-receptionist-http'
export async function POST(request: NextRequest) {
  let token: string | null = null
  const response = await pilotResponse(async () => {
    requirePilotOrigin(request)
    token = pilotSessionSchema.parse(await readWebsiteBody(request)).token
    return { received: true }
  })
  if (response.ok && token)
    response.cookies.set(PILOT_COOKIE_NAME, token, pilotCookieOptions(3600))
  return response
}
export async function DELETE(request: NextRequest) {
  const response = await pilotResponse(async () => {
    requirePilotOrigin(request)
    return { cleared: true }
  })
  if (response.ok)
    response.cookies.set(PILOT_COOKIE_NAME, '', pilotCookieOptions(0))
  return response
}
