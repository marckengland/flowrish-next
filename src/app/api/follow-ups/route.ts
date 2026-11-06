import { taskProgressFromRequest } from '@/lib/follow-up-task-progress'
import { AppError } from '@/lib/errors'
import { followUpPageFromRequest, callbackProgressFromRequest } from '@/lib/follow-up-page'
import { followUpFiltersFromQuery } from '@/lib/follow-up-filters'
import { listFollowUps } from '@/server/services/follow-ups'
import { followUpHttp } from '@/server/services/follow-up-http'
export async function GET(request: Request) {
  return followUpHttp(request, false, async session => { const query = new URL(request.url).searchParams, retained = query.getAll('retain'), filters = followUpFiltersFromQuery(query), paging = followUpPageFromRequest(request), includeProgress = callbackProgressFromRequest(request), taskProgress = taskProgressFromRequest(request); if (filters?.taskProgress && !taskProgress) throw new AppError('VALIDATION_ERROR', 'Opt in to task progress before filtering.', 400); const result = taskProgress ? await listFollowUps(session.organizationId, session.dbUser.id, query.get('status') ?? 'PENDING', retained, filters ?? {}, paging, true) : paging ? await listFollowUps(session.organizationId, session.dbUser.id, query.get('status') ?? 'PENDING', retained, filters ?? {}, paging) : filters ? await listFollowUps(session.organizationId, session.dbUser.id, query.get('status') ?? 'PENDING', retained, filters) : await listFollowUps(session.organizationId, session.dbUser.id, query.get('status') ?? 'PENDING', ...(retained.length ? [retained] as [string[]] : [])); const page = result.page && (includeProgress ? result.page : { nextCursor: result.page.nextCursor, accessVersion: result.page.accessVersion }); return { data: result.items, canWrite: result.canWrite, ...(taskProgress ? { taskProgress: true } : {}), ...(page ? { page } : {}) } })
}
