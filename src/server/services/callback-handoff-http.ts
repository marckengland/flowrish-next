import 'server-only'
import { AppError } from '@/lib/errors'
import { readWebsiteBody } from './website-receptionist-http'

export async function readHandoffBody(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) throw new AppError('FORBIDDEN', 'Use Flowrish to review and approve this handoff.', 403)
  return readWebsiteBody(request)
}
