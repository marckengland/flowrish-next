import { OnboardingForm } from './onboarding-form'

/**
 * Onboarding page — shown to new users after sign-up.
 * Allows creating a new Organization or joining one via invite code.
 *
 * This is a Server Component that renders the client-side form.
 *
 * Validates: Requirements 2.3
 */
export default function OnboardingPage() {
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
