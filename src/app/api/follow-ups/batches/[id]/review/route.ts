import { z } from 'zod'
import { AppError } from '@/lib/errors'
import { remainingTaskInput } from '@/lib/follow-up-remaining-tasks'
import { followUpHttp } from '@/server/services/follow-up-http'
import { reviewRemainingTasks } from '@/server/services/follow-up-remaining-tasks'
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
 return followUpHttp(request, true, async session => {
  const query = new URL(request.url).searchParams
  if ([...query.keys()].some(key => !['index', 'localTime', 'timeZone'].includes(key)) || query.getAll('localTime').length > 1 || query.getAll('timeZone').length > 1 || query.has('localTime') !== query.has('timeZone')) throw new AppError('VALIDATION_ERROR', 'Choose tasks and one valid deadline.', 400)
  const input = remainingTaskInput.parse({ indices: query.getAll('index').map(value => Number(z.string().regex(/^(0|[1-9]\d?)$/).parse(value))), ...(query.has('localTime') ? { target: { localTime: query.get('localTime'), timeZone: query.get('timeZone') } } : {}) })
  return { data: await reviewRemainingTasks(session.organizationId, session.dbUser.id, z.string().uuid().parse((await context.params).id), input), canWrite: true }
 })
}
