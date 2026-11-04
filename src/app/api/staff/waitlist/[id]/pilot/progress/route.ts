import { pilotStaffResponse } from '@/server/services/pilot-staff-http'
import { getPilotProgress } from '@/server/services/pilot-progress'
export const dynamic = 'force-dynamic'
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return pilotStaffResponse(async (session) =>
    getPilotProgress(
      session.organizationId,
      session.dbUser.id,
      (await context.params).id,
    ),
  )
}
