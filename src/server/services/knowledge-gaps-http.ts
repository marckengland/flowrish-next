import 'server-only'
import { AppError } from '@/lib/errors'

export function readGapQuery(request: Request): Record<string, string> {
  const query = new URL(request.url).searchParams
  if (query.toString().length > 256 || [...query.keys()].some(key => query.getAll(key).length !== 1)) throw new AppError('VALIDATION_ERROR', 'Use one valid status and page value.', 400)
  return Object.fromEntries(query)
}
