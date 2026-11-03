import 'server-only'
import { AppError } from '@/lib/errors'
import { readWebsiteBody } from './website-receptionist-http'
export async function readSetupBody(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) throw new AppError('FORBIDDEN', 'Use Flowrish to review and save setup.', 403)
  return readWebsiteBody(request)
}
