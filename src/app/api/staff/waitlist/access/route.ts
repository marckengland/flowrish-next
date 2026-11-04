import { requireSession } from '@/server/auth/session'
import { hasWaitlistStaffAccess } from '@/server/auth/waitlist-staff'
import { staffWaitlistJson } from '@/server/services/staff-waitlist-http'
import { errorResponse } from '@/lib/errors'
export const dynamic = 'force-dynamic'
export async function GET() {
  try {
    const session = await requireSession()
    return staffWaitlistJson({
      allowed: await hasWaitlistStaffAccess(
        session.organizationId,
        session.dbUser.id,
      ),
    })
  } catch (error) {
    const response = errorResponse(error)
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  }
}
