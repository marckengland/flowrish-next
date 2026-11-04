import { staffWaitlistResponse } from '@/server/services/staff-waitlist-http'
import {
  getWaitlistHandoffOptions,
  commitWaitlistHandoff,
} from '@/server/services/staff-waitlist'
import { readHandoffBody } from '@/server/services/callback-handoff-http'
type Context = { params: Promise<{ id: string }> }
export const dynamic = 'force-dynamic'
export async function GET(_request: Request, context: Context) {
  return staffWaitlistResponse(async (session) =>
    getWaitlistHandoffOptions(
      session.organizationId,
      session.dbUser.id,
      (await context.params).id,
    ),
  )
}
export async function POST(request: Request, context: Context) {
  return staffWaitlistResponse(async (session) =>
    commitWaitlistHandoff(
      session.organizationId,
      session.dbUser.id,
      (await context.params).id,
      await readHandoffBody(request),
    ),
  )
}
