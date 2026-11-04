import type { Metadata } from 'next'
import { PilotOnboarding } from '@/components/receptionist/pilot-onboarding'
export const metadata: Metadata = {
  title: 'Pilot workspace setup',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
  alternates: { canonical: '/pilot' },
}
export default function PilotPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <PilotOnboarding />
    </main>
  )
}
