import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AppError, errorResponse } from '@/lib/errors'
import { WORKSPACE_COOKIE } from '@/lib/workspace-context'
import { getWorkspaceIdentity } from '@/server/auth/session'
import { prisma } from '@/server/db/client'

const noStore = { 'Cache-Control': 'private, no-store' }
const selection = z.object({ organizationId: z.string().uuid() }).strict()

export async function GET(_request: NextRequest) {
  try {
    const identity = await getWorkspaceIdentity()
    if (!identity)
      throw new AppError('UNAUTHORIZED', 'Authentication required', 401)
    const memberships = await prisma.organizationMember.findMany({
      where: { userId: identity.dbUser.id },
      select: { organization: { select: { id: true, name: true } } },
      orderBy: { organization: { name: 'asc' } },
    })
    return NextResponse.json(
      { data: { workspaces: memberships.map((x) => x.organization) } },
      { headers: noStore },
    )
  } catch (error) {
    const response = errorResponse(error)
    response.headers.set('Cache-Control', noStore['Cache-Control'])
    return response
  }
}

export async function POST(request: NextRequest) {
  try {
    if (request.headers.get('origin') !== new URL(request.url).origin)
      throw new AppError('FORBIDDEN', 'Use Flowrish to choose a business.', 403)
    const identity = await getWorkspaceIdentity()
    if (!identity)
      throw new AppError('UNAUTHORIZED', 'Authentication required', 401)
    // The selector body is small and contains no customer content or credentials.
    const text = await request.text()
    if (text.length > 1024)
      throw new AppError('VALIDATION_ERROR', 'Invalid business selection.', 400)
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      throw new AppError('VALIDATION_ERROR', 'Invalid business selection.', 400)
    }
    const { organizationId } = selection.parse(body)
    const membership = await prisma.organizationMember.findUnique({
      where: {
        userId_organizationId: { userId: identity.dbUser.id, organizationId },
      },
      select: { organizationId: true },
    })
    if (!membership)
      throw new AppError(
        'WORKSPACE_ACCESS_REVOKED',
        'You no longer have access to this business.',
        403,
      )
    const response = NextResponse.json(
      { data: { organizationId } },
      { headers: noStore },
    )
    response.cookies.set(
      WORKSPACE_COOKIE,
      `${identity.authUser.id}:${organizationId}`,
      {
        httpOnly: true,
        secure: new URL(request.url).protocol === 'https:',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
      },
    )
    return response
  } catch (error) {
    const response = errorResponse(error)
    response.headers.set('Cache-Control', noStore['Cache-Control'])
    return response
  }
}
