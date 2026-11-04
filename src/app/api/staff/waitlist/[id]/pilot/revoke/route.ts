import { revokePilotInvitation } from '@/server/services/pilot-onboarding'
import { pilotStaffResponse } from '@/server/services/pilot-staff-http'
import { readHandoffBody } from '@/server/services/callback-handoff-http'
type Context = { params: Promise<{ id: string }> }
export async function POST(request: Request, context: Context) {
  return pilotStaffResponse(async (session) =>
    revokePilotInvitation(
      session.organizationId,
      session.dbUser.id,
      (await context.params).id,
      await readHandoffBody(request),
    ),
  )
}
