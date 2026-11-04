import { staffWaitlistResponse } from '@/server/services/staff-waitlist-http'
import { previewWaitlistHandoff } from '@/server/services/staff-waitlist'
import { readHandoffBody } from '@/server/services/callback-handoff-http'
type Context = { params: Promise<{ id: string }> }
export async function POST(request: Request, context: Context) {
  return staffWaitlistResponse(async (session) =>
    previewWaitlistHandoff(
      session.organizationId,
      session.dbUser.id,
      (await context.params).id,
      await readHandoffBody(request),
    ),
  )
}
