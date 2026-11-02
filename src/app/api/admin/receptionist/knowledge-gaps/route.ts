import { rehearsalResponse } from '@/server/services/receptionist-rehearsal-http'
import { readGapQuery } from '@/server/services/knowledge-gaps-http'
import { getKnowledgeGapList } from '@/server/services/knowledge-gaps'

export async function GET(request: Request) {
  return rehearsalResponse(session => getKnowledgeGapList(session.organizationId, session.dbUser.id, readGapQuery(request)))
}
