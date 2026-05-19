import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { prisma } from '@/server/db/client'

/**
 * OAuth callback handler.
 * Exchanges the authorization code for a session, then checks if the user
 * already has an application User record. If not, creates one and redirects
 * to onboarding. If yes, redirects to the dashboard.
 *
 * Uses the request/response cookie pattern to ensure the session cookies
 * are properly set on the redirect response.
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

  // Create a response that we'll attach cookies to
  const redirectUrl = new URL(next, origin)
  const response = NextResponse.redirect(redirectUrl)

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    },
  )

  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !data.user) {
    return NextResponse.redirect(
      new URL('/login?error=auth_failed', origin)
    )
  }

  const authUser = data.user

  // Check if application User record exists
  const existingUser = await prisma.user.findUnique({
    where: { authId: authUser.id },
  })

  if (existingUser) {
    // Existing user → redirect to dashboard (cookies already on response)
    return response
  }

  // New user → create User record, then redirect to onboarding
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

  // Redirect to onboarding with cookies
  const onboardingResponse = NextResponse.redirect(
    new URL('/onboarding', origin),
  )
  // Copy cookies from the original response
  response.cookies.getAll().forEach((cookie) => {
    onboardingResponse.cookies.set(cookie.name, cookie.value)
  })

  return onboardingResponse
}
