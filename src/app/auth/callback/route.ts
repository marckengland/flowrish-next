import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { prisma } from '@/server/db/client'

/**
 * OAuth callback handler.
 * Exchanges the authorization code for a session, then checks if the user
 * already has an application User record. If not, creates one and redirects
 * to onboarding. If yes, redirects to the dashboard.
 *
 * Uses a two-phase approach:
 * 1. Exchange code with cookies written to a temporary response
 * 2. Copy all cookies to the final redirect response
 *
 * Validates: Requirements 1.3, 1.4
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', origin))
  }

  // Collect cookies that Supabase sets during the exchange
  const cookieStore: { name: string; value: string; options: CookieOptions }[] = []

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach((cookie) => {
            cookieStore.push(cookie)
          })
        },
      },
    },
  )

  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !data.user) {
    return NextResponse.redirect(
      new URL('/login?error=auth_failed', origin),
    )
  }

  const authUser = data.user

  // Check if application User record exists
  const existingUser = await prisma.user.findUnique({
    where: { authId: authUser.id },
  })

  // Determine redirect destination
  const redirectTo = existingUser ? next : '/onboarding'

  // Build the redirect response and attach all session cookies
  const response = NextResponse.redirect(new URL(redirectTo, origin))

  cookieStore.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options)
  })

  // Create User record for new users
  if (!existingUser) {
    await prisma.user.create({
      data: {
        authId: authUser.id,
        email: authUser.email ?? '',
        name:
          authUser.user_metadata?.full_name ??
          authUser.user_metadata?.name ??
          authUser.email?.split('@')[0] ??
          'User',
        avatarUrl: authUser.user_metadata?.avatar_url ?? null,
      },
    })
  }

  return response
}
