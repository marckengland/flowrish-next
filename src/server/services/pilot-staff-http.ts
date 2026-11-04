import 'server-only'
import { requireSession, type Session } from '@/server/auth/session'
import { assertWaitlistStaff } from '@/server/auth/waitlist-staff'
import { pilotResponse } from './pilot-http'
export function pilotStaffResponse(
  work: (session: Session) => Promise<unknown>,
) {
  return pilotResponse(async () => {
    const session = await requireSession()
    await assertWaitlistStaff(session.organizationId, session.dbUser.id)
    return work(session)
  })
}
