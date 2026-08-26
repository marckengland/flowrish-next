import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'

import { requireSession } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { LeadDiscovery } from '@/components/leads/lead-discovery'

/**
 * `/leads/discover` — keyless lead discovery (OpenStreetMap).
 *
 * Requires `leads:write` since the whole point is importing new companies.
 * Search + import both run through /api/lead-discovery/*.
 */
export default async function DiscoverLeadsPage(): Promise<React.JSX.Element> {
  const session = await requireSession()

  if (!hasPermission(session.dbUser, 'leads:write')) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-md border bg-card p-6">
        <h1 className="text-lg font-semibold">Find leads</h1>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to add leads in this organization.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <nav>
        <Link
          href="/leads"
          className="inline-flex items-center gap-1.5 font-mono text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          <span>Back to leads</span>
        </Link>
      </nav>

      <header>
        <h1 className="text-[24px] font-bold leading-tight tracking-[-0.02em]">
          Find leads
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search for local businesses by location and category, then add the
          ones you want as companies.
        </p>
      </header>

      <LeadDiscovery />
    </div>
  )
}
