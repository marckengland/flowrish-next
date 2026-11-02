import { rehearsalResponse, readRehearsalBody } from '@/server/services/receptionist-rehearsal-http'
import { readGapQuery } from '@/server/services/knowledge-gaps-http'
import { getKnowledgeGapDetail, reviewKnowledgeGap } from '@/server/services/knowledge-gaps'

type Context = { params: Promise<{ key: string }> }
export async function GET(request: Request, context: Context) {
  return rehearsalResponse(async session => getKnowledgeGapDetail(session.organizationId, session.dbUser.id, (await context.params).key, readGapQuery(request)))
}
export async function PATCH(request: Request, context: Context) {
  return rehearsalResponse(async session => reviewKnowledgeGap(session.organizationId, session.dbUser.id, (await context.params).key, await readRehearsalBody(request)))
}
