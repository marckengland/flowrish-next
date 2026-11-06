import { z } from 'zod'
import { AppError } from '@/lib/errors'
import { followUpHttp } from '@/server/services/follow-up-http'
import { readTaskBatch } from '@/server/services/follow-up-task-batches'
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
 return followUpHttp(request, false, async session => {
  if (new URL(request.url).search) throw new AppError('VALIDATION_ERROR', 'Choose one saved batch.', 400)
  const { canReview, ...data } = await readTaskBatch(session.organizationId, session.dbUser.id, z.string().uuid().parse((await context.params).id))
  return { data, canWrite: canReview === true }
 })
}
