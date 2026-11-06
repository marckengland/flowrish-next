import { TASK_BATCH_HEADER } from '@/lib/follow-up-task-batches'
import { withTaskBatchAttempt } from '@/server/services/follow-up-task-batches'
import { z } from 'zod'
import { AppError } from '@/lib/errors'
import { taskRescheduleTarget } from '@/lib/follow-up-task-reschedule'
import { followUpBody, followUpHttp, followUpId } from '@/server/services/follow-up-http'
import { previewTaskReschedule, readTaskReschedule, rescheduleFollowUpTask } from '@/server/services/follow-up-task-reschedule'
type Context = { params: Promise<{ id: string }> }
export async function GET(request: Request, context: Context) {
 return followUpHttp(request, true, async session => {
  const id = followUpId((await context.params).id), q = new URL(request.url).searchParams
  if ([...q.keys()].some(key => !['requestId', 'localTime', 'timeZone'].includes(key) || q.getAll(key).length !== 1) || q.has('requestId') && q.size !== 1) throw new AppError('VALIDATION_ERROR', 'Choose one deadline review or request check.', 400)
  const data = q.has('requestId') ? await readTaskReschedule(session.organizationId, session.dbUser.id, id, z.string().uuid().parse(q.get('requestId'))) : await previewTaskReschedule(session.organizationId, session.dbUser.id, id, taskRescheduleTarget.parse(Object.fromEntries(q)))
  return { data, canWrite: true }
 })
}
export async function POST(request: Request, context: Context) {
 return followUpHttp(request, true, async session => {
  const id = followUpId((await context.params).id), body = await followUpBody(request), header = request.headers.get(TASK_BATCH_HEADER)
  const run = () => rescheduleFollowUpTask(session.organizationId, session.dbUser.id, id, body)
  return { data: header === null ? await run() : await withTaskBatchAttempt(session.organizationId, session.dbUser.id, z.string().uuid().parse(header), 'RESCHEDULE', id, body, run), canWrite: true }
 })
}
