import { rehearsalResponse } from '@/server/services/receptionist-rehearsal-http'
import { readGapQuery } from '@/server/services/knowledge-gaps-http'
import { listWebsiteCallbacks } from '@/server/services/website-receptionist'
export async function GET(request: Request) { return rehearsalResponse(session => listWebsiteCallbacks(session.organizationId, session.dbUser.id, readGapQuery(request))) }
