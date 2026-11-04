import { staffWaitlistResponse } from '@/server/services/staff-waitlist-http'
import { updateStaffWaitlist } from '@/server/services/staff-waitlist'
import { readHandoffBody } from '@/server/services/callback-handoff-http'
type Context = { params: Promise<{ id: string }> }
export async function PATCH(request: Request, context: Context) {
  return staffWaitlistResponse(async (session) =>
    updateStaffWaitlist(
      session.organizationId,
      session.dbUser.id,
      (await context.params).id,
      await readHandoffBody(request),
    ),
  )
}
