import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { prisma } from '@/server/db/client'
import { acceptInvite } from '@/server/services/organizations'

/**
 * OAuth / Magic Link callback handler.
 *
 * Flow:
 * 1. Exchange the authorization code for a session
 * 2. Check if the user has an application User record (create if not)
 * 3. Check for pending organization invites matching the user's email
 *    - If found, auto-accept the invite (creates org membership + team membership)
 *    - Redirect to dashboard
 * 4. If no invite and no org membership, redirect to onboarding
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
  const userEmail = authUser.email?.toLowerCase() ?? ''

  // Check if application User record exists
  let dbUser = await prisma.user.findUnique({
    where: { authId: authUser.id },
    include: { organizationMemberships: true },
  })

  // Create User record for new users
  if (!dbUser) {
    dbUser = await prisma.user.create({
      data: {
        authId: authUser.id,
        email: userEmail,
        name:
          authUser.user_metadata?.full_name ??
          authUser.user_metadata?.name ??
          authUser.email?.split('@')[0] ??
          'User',
        avatarUrl: authUser.user_metadata?.avatar_url ?? null,
      },
      include: { organizationMemberships: true },
    })
  }

  // Check for pending invites matching this user's email
  let redirectTo = next
  if (dbUser.organizationMemberships.length === 0) {
    const pendingInvite = await prisma.organizationInvite.findFirst({
      where: {
        email: userEmail,
        status: 'pending',
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (pendingInvite) {
      // Auto-accept the invite
      try {
        await acceptInvite(pendingInvite.id, dbUser.id)
        redirectTo = '/' // Go to dashboard — they now have an org
      } catch {
        // If auto-accept fails, send to onboarding where they can try manually
        redirectTo = '/onboarding'
      }
    } else {
      // No invite, no org — send to onboarding
      redirectTo = '/onboarding'
    }
  }

  // Build the redirect response and attach all session cookies
  const response = NextResponse.redirect(new URL(redirectTo, origin))

  cookieStore.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options)
  })

  return response
}
