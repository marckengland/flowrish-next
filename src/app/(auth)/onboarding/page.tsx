import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { prisma } from '@/server/db/client'
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
    redirect('/')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Get Started
          </h1>
          <p className="text-sm text-muted-foreground">
            Create a new organization or join an existing one with an invite code.
          </p>
        </div>

        <OnboardingForm />
      </div>
    </div>
  )
}
