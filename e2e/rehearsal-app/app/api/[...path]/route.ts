import { appendFileSync } from 'node:fs'
import { homeFixture } from '@/components/receptionist/home-fixture.test-data'
import { coreIds } from '../../../core-fixtures'

export function GET(request: Request) {
  const path = new URL(request.url).pathname
  if (path === '/api/lead-views') return Response.json({ data: [], scope: { organizationId: coreIds.organization, userId: coreIds.user } })
  if (path === '/api/receptionist/home')
    return Response.json({ data: homeFixture() })
  if (path === '/api/email/sync')
    return Response.json({ data: [], capabilities: { canWrite: true } })
  if (['/api/admin/scoring-rules', '/api/leads/ranked'].includes(path))
    return Response.json({ data: [] })
  return Response.json(
    { error: { message: 'No synthetic fixture for this read.' } },
    { status: 404 },
  )
}

function reject() {
  const log = process.env.REHEARSAL_GUARD_LOG
  if (log) appendFileSync(log, 'Unmocked fixture API mutation\n')
  return Response.json(
    { error: { message: 'Unmocked writes are forbidden.' } },
    { status: 403 },
  )
}
export const POST = reject
export const PUT = reject
export const PATCH = reject
export const DELETE = reject
