import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { prisma } from '@/server/db/client'

/**
 * OAuth callback handler.
 * Exchanges the authorization code for a session, then checks if the user
 * already has an application User record. If not, creates one and redirects
 * to onboarding. If yes, redirects to the dashboard.
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

  const supabase = await createSupabaseServer()

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
    // Existing user → redirect to dashboard
    return NextResponse.redirect(new URL(next, origin))
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

  return NextResponse.redirect(new URL('/onboarding', origin))
}
