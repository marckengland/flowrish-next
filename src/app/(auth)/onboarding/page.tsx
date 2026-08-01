import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { prisma } from '@/server/db/client'
import { AuthBrandPanel } from '@/components/layout/auth-brand-panel'
import { PrivateBetaBadge } from '@/components/ui/private-beta-badge'
import { isWaitlistEnabled } from '@/lib/waitlist'
import { OnboardingForm } from './onboarding-form'

/**
 * Onboarding page — shown to new users after sign-up.
 * Allows creating a new Organization or joining one via invite code.
 *
 * Guards:
 * - Unauthenticated users are redirected to /login by the middleware
 * - Users who already have an org membership are redirected to /
 *
 * Validates: Requirements 2.3
 */
export default async function OnboardingPage() {
  // Check if user already has an org (completed onboarding before)
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const dbUser = await prisma.user.findUnique({
    where: { authId: user.id },
    include: { organizationMemberships: true },
  })

  if (!dbUser) {
    redirect('/login')
  }

  // If user already has an org, they don't need onboarding
  if (dbUser.organizationMemberships.length > 0) {
    redirect('/dashboard')
  }

  return (
    <div className="grid min-h-screen bg-card lg:grid-cols-[1.05fr_1fr]">
      <AuthBrandPanel />

      <div className="flex items-center justify-center bg-card px-6 py-12">
        <div className="w-full max-w-[380px]">
          {isWaitlistEnabled() && <PrivateBetaBadge className="mb-3" />}
          <h1 className="mb-1.5 text-[26px] font-bold tracking-[-0.02em] text-foreground">
            Set up your workspace
          </h1>
          <p className="mb-6 text-[14.5px] text-muted-foreground">
            Create an organization or join with an invite.
          </p>

          <OnboardingForm />

          <p className="mt-6 text-center text-[13.5px] text-muted-foreground">
            Already have a workspace?{' '}
            <Link
              href="/login"
              className="font-semibold text-brand-emphasis hover:underline"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
