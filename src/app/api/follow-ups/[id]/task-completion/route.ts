import { TASK_BATCH_HEADER } from '@/lib/follow-up-task-batches'
import { withTaskBatchAttempt } from '@/server/services/follow-up-task-batches'
import { z } from 'zod'
import { AppError } from '@/lib/errors'
import { followUpBody, followUpHttp, followUpId } from '@/server/services/follow-up-http'
import { completeFollowUpTask, previewTaskCompletion, readTaskCompletion } from '@/server/services/follow-up-task-completion'

type Context = { params: Promise<{ id: string }> }
export async function GET(request: Request, context: Context) {
 return followUpHttp(request, true, async session => {
  const id = followUpId((await context.params).id), query = new URL(request.url).searchParams
  if ([...query.keys()].some(key => key !== 'requestId') || query.getAll('requestId').length > 1) throw new AppError('VALIDATION_ERROR', 'Choose one task completion request.', 400)
  const requestId = query.has('requestId') ? z.string().uuid().parse(query.get('requestId')) : undefined
  return { data: requestId ? await readTaskCompletion(session.organizationId, session.dbUser.id, id, requestId) : await previewTaskCompletion(session.organizationId, session.dbUser.id, id), canWrite: true }
 })
}
export async function POST(request: Request, context: Context) {
 return followUpHttp(request, true, async session => {
  const id = followUpId((await context.params).id), body = await followUpBody(request), header = request.headers.get(TASK_BATCH_HEADER)
  const run = () => completeFollowUpTask(session.organizationId, session.dbUser.id, id, body)
  return { data: header === null ? await run() : await withTaskBatchAttempt(session.organizationId, session.dbUser.id, z.string().uuid().parse(header), 'COMPLETE', id, body, run), canWrite: true }
 })
}
