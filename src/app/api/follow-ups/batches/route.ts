import { AppError } from '@/lib/errors'
import { followUpBody, followUpHttp } from '@/server/services/follow-up-http'
import { listTaskBatches, saveTaskBatch } from '@/server/services/follow-up-task-batches'
export async function GET(request: Request) {
 return followUpHttp(request, false, async session => {
  const query = new URL(request.url).searchParams
  if ([...query.keys()].some(key => key !== 'cursor') || query.getAll('cursor').length > 1) throw new AppError('VALIDATION_ERROR', 'Choose one history page.', 400)
  return { data: await listTaskBatches(session.organizationId, session.dbUser.id, query.get('cursor') ?? undefined), canWrite: false }
 })
}
export async function POST(request: Request) {
 return followUpHttp(request, true, async session => ({ data: await saveTaskBatch(session.organizationId, session.dbUser.id, await followUpBody(request)), canWrite: true }))
}
