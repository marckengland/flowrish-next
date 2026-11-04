import type { NextRequest } from 'next/server'
import { PILOT_COOKIE_NAME, pilotAcceptSchema } from '@/lib/pilot-onboarding'
import { getPilotIdentity } from '@/server/auth/pilot-identity'
import { acceptPilotInvitation } from '@/server/services/pilot-onboarding'
import { pilotResponse, requirePilotOrigin } from '@/server/services/pilot-http'
import { readWebsiteBody } from '@/server/services/website-receptionist-http'
export async function POST(request: NextRequest) {
  return pilotResponse(async () => {
    requirePilotOrigin(request)
    const input = pilotAcceptSchema.parse(await readWebsiteBody(request))
    return acceptPilotInvitation(
      request.cookies.get(PILOT_COOKIE_NAME)?.value ?? '',
      await getPilotIdentity(),
      input,
    )
  })
}
