import type { NextRequest } from 'next/server'
import { PILOT_COOKIE_NAME, pilotTokenSchema } from '@/lib/pilot-onboarding'
import { getPilotIdentity } from '@/server/auth/pilot-identity'
import { getPilotStatus } from '@/server/services/pilot-onboarding'
import { pilotResponse } from '@/server/services/pilot-http'
export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
  return pilotResponse(async () => {
    const token = request.cookies.get(PILOT_COOKIE_NAME)?.value
    if (!pilotTokenSchema.safeParse(token).success) return { state: 'missing' }
    return getPilotStatus(token!, await getPilotIdentity())
  })
}
