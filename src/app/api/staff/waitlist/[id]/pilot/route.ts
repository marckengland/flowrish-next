import {
  getPilotInvitation,
  issuePilotInvitation,
} from '@/server/services/pilot-onboarding'
import { pilotStaffResponse } from '@/server/services/pilot-staff-http'
import { readHandoffBody } from '@/server/services/callback-handoff-http'
type Context = { params: Promise<{ id: string }> }
export const dynamic = 'force-dynamic'
export async function GET(_request: Request, context: Context) {
  return pilotStaffResponse(async (session) =>
    getPilotInvitation(
      session.organizationId,
      session.dbUser.id,
      (await context.params).id,
    ),
  )
}
export async function POST(request: Request, context: Context) {
  return pilotStaffResponse(async (session) =>
    issuePilotInvitation(
      session.organizationId,
      session.dbUser.id,
      (await context.params).id,
      await readHandoffBody(request),
    ),
  )
}
