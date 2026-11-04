import { staffWaitlistResponse } from '@/server/services/staff-waitlist-http'
import { listStaffWaitlist } from '@/server/services/staff-waitlist'
export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  return staffWaitlistResponse((session) =>
    listStaffWaitlist(
      session.organizationId,
      session.dbUser.id,
      Object.fromEntries(new URL(request.url).searchParams),
    ),
  )
}
