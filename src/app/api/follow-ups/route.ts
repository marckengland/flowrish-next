import { followUpFiltersFromQuery } from '@/lib/follow-up-filters'
import { listFollowUps } from '@/server/services/follow-ups'
import { followUpHttp } from '@/server/services/follow-up-http'
export async function GET(request: Request) {
  return followUpHttp(request, false, async session => { const query = new URL(request.url).searchParams, retained = query.getAll('retain'), filters = followUpFiltersFromQuery(query); const result = filters ? await listFollowUps(session.organizationId, session.dbUser.id, query.get('status') ?? 'PENDING', retained, filters) : await listFollowUps(session.organizationId, session.dbUser.id, query.get('status') ?? 'PENDING', ...(retained.length ? [retained] as [string[]] : [])); return { data: result.items, canWrite: result.canWrite } })
}
