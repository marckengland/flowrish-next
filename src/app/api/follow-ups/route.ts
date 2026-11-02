import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { listFollowUps } from '@/server/services/follow-ups'
import { errorResponse } from '@/lib/errors'

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:read')
    return NextResponse.json({ data: await listFollowUps(session.organizationId, session.dbUser.id, request.nextUrl.searchParams.get('status') ?? 'PENDING') })
  } catch (error) { return errorResponse(error) }
}
