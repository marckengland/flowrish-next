import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { prisma } from '@/server/db/client'

/**
 * Magic link confirmation handler.
 * Verifies the OTP token from the magic link email, then checks if the user
 * already has an application User record. If not, creates one and redirects
 * to onboarding. If yes, redirects to the dashboard.
 *
 * Validates: Requirements 1.1, 1.2, 1.4
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const next = searchParams.get('next') ?? '/dashboard'

  if (!tokenHash || type !== 'magiclink') {
    return NextResponse.redirect(
      new URL('/login?error=invalid_link', origin)
    )
  }

  const supabase = await createSupabaseServer()

  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'magiclink',
  })

  if (error || !data.user) {
    return NextResponse.redirect(
      new URL('/login?error=verification_failed', origin)
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
      name: authUser.email?.split('@')[0] ?? 'User',
      avatarUrl: null,
    },
  })

  return NextResponse.redirect(new URL('/onboarding', origin))
}
