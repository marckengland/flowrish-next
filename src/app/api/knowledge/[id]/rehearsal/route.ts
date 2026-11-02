import { rehearsalResponse } from '@/server/services/receptionist-rehearsal-http'
import { getRehearsalFaqOrigin } from '@/server/services/rehearsal-faq'

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return rehearsalResponse(async session => getRehearsalFaqOrigin(session.organizationId, session.dbUser.id, (await context.params).id))
}
