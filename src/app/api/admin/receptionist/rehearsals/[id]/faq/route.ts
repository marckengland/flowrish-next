import { rehearsalResponse, readRehearsalBody } from '@/server/services/receptionist-rehearsal-http'
import { createRehearsalFaq } from '@/server/services/rehearsal-faq'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return rehearsalResponse(async session => createRehearsalFaq(session.organizationId, session.dbUser.id, (await context.params).id, await readRehearsalBody(request)))
}
