import type { Metadata } from 'next'
import Link from 'next/link'
import { ReceptionistDemo } from '@/components/receptionist/receptionist-demo'
import { PUBLIC_PRICING_MESSAGE } from '@/lib/plans'
import type { DemoBusiness } from '@/lib/receptionist-demo'

export const metadata: Metadata = {
  title: 'Receptionist demo',
  description:
    'Try a prewritten Flowrish receptionist conversation and simulated callback workflow. No sign-in needed.',
  alternates: { canonical: '/demo' },
}

// Fixed public examples, independent of organization settings and Library data.
const sampleBusiness: DemoBusiness = {
  source: 'sample',
  name: 'Flowrish sample',
  services:
    'Flowrish brings sales pipelines, follow-ups, lead prioritization, and callback management into one CRM.',
  pricing: PUBLIC_PRICING_MESSAGE,
  hours: 'Mon–Fri 9am–5pm, Asia/Manila',
  callbackHours: {
    timeZone: 'Asia/Manila',
    opensAt: '09:00',
    closesAt: '17:00',
    businessDays: [1, 2, 3, 4, 5],
    version: '2026-01-01T00:00:00.000Z',
    calendarExceptions: [],
  },
}

export default function PublicDemoPage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav aria-label="Demo navigation" className="border-b bg-card">
        <div className="mx-auto flex min-h-[68px] max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Flowrish
          </Link>
          <Link
            href="/#waitlist"
            className="inline-flex min-h-11 items-center rounded-xl bg-brand px-4 text-sm font-semibold text-brand-foreground hover:bg-brand-hover"
          >
            Join the waitlist
          </Link>
        </div>
      </nav>
      <main className="mx-auto max-w-6xl space-y-5 px-5 py-8 sm:px-8 sm:py-12">
        <p className="text-sm text-muted-foreground">
          No sign-in needed. Explore with fictional details; join the waitlist
          to contact the team.
        </p>
        <ReceptionistDemo business={sampleBusiness} />
      </main>
    </div>
  )
}
