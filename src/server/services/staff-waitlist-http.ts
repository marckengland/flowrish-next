import 'server-only'
import { NextResponse } from 'next/server'
import { requireSession, type Session } from '@/server/auth/session'
import { assertWaitlistStaff } from '@/server/auth/waitlist-staff'
import { errorResponse } from '@/lib/errors'

export function staffWaitlistJson(data: unknown) {
  return NextResponse.json(
    { data },
    { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } },
  )
}

export async function staffWaitlistResponse(
  work: (session: Session) => Promise<unknown>,
) {
  try {
    const session = await requireSession()
    await assertWaitlistStaff(session.organizationId, session.dbUser.id)
    return staffWaitlistJson(await work(session))
  } catch (error) {
    const response = errorResponse(error)
    response.headers.set('Cache-Control', 'private, no-store')
    response.headers.set('Vary', 'Cookie')
    return response
  }
}
