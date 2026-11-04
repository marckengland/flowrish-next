import 'server-only'
import { randomBytes } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import type { Session } from '@/server/auth/session'
import { AppError } from '@/lib/errors'

export type MailProvider = 'gmail' | 'microsoft'
export const emailOAuthCookie = (provider: MailProvider) =>
  `flowrish_mail_oauth_${provider}`
const options = { httpOnly: true, sameSite: 'lax' as const, path: '/api/email' }

export function startEmailOAuth(
  request: NextRequest,
  session: Session,
  provider: MailProvider,
) {
  const state = randomBytes(32).toString('base64url')
  const context = {
    state,
    userId: session.authUser.id,
    organizationId: session.organizationId,
    expires: Date.now() + 10 * 60 * 1000,
  }
  const response = NextResponse.json(
    { data: { state } },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
  response.cookies.set(emailOAuthCookie(provider), JSON.stringify(context), {
    ...options,
    secure: new URL(request.url).protocol === 'https:',
    maxAge: 600,
  })
  return response
}

export function requireEmailOAuth(
  request: NextRequest,
  session: Session,
  provider: MailProvider,
) {
  const fail = () => {
    throw new AppError(
      'WORKSPACE_CHANGED',
      'Connection expired or the business changed. Start again in Settings.',
      409,
    )
  }
  try {
    const raw = request.cookies.get(emailOAuthCookie(provider))?.value
    if (!raw) return fail()
    const context = JSON.parse(raw)
    const state = request.nextUrl.searchParams.get('state')
    if (
      !state ||
      typeof context.state !== 'string' ||
      context.state.length < 32 ||
      context.state !== state ||
      context.userId !== session.authUser.id ||
      context.organizationId !== session.organizationId ||
      !Number.isFinite(context.expires) ||
      context.expires <= Date.now()
    )
      return fail()
  } catch {
    return fail()
  }
}

export function consumeEmailOAuth(
  response: NextResponse,
  provider: MailProvider,
) {
  response.cookies.set(emailOAuthCookie(provider), '', {
    ...options,
    maxAge: 0,
  })
  response.headers.set('Cache-Control', 'private, no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}
