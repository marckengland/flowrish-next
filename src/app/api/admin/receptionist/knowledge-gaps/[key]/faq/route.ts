import { rehearsalResponse, readRehearsalBody } from '@/server/services/receptionist-rehearsal-http'
import { createKnowledgeGapFaq } from '@/server/services/knowledge-gaps'

export async function POST(request: Request, context: { params: Promise<{ key: string }> }) {
  return rehearsalResponse(async session => createKnowledgeGapFaq(session.organizationId, session.dbUser.id, (await context.params).key, await readRehearsalBody(request)))
}
