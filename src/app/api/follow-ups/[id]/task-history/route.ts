import { AppError } from '@/lib/errors'
import { taskHistoryQuery } from '@/lib/follow-up-task-history'
import { followUpHttp, followUpId } from '@/server/services/follow-up-http'
import { listTaskHistory } from '@/server/services/follow-up-task-history'
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
 return followUpHttp(request, false, async session => {
  const q = new URL(request.url).searchParams
  if (q.getAll('page').length > 1) throw new AppError('VALIDATION_ERROR', 'Choose one task activity page.', 400)
  const input = Object.fromEntries(q); taskHistoryQuery.parse(input)
  return listTaskHistory(session.organizationId, session.dbUser.id, followUpId((await context.params).id), input)
 })
}
