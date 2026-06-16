import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'

import { requireSession } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { getOrCreateDefaultPipeline } from '@/server/services/pipeline'

import { NewLeadForm } from '@/components/leads/new-lead-form'
import type { LeadFormStage } from '@/components/leads/lead-form'

/**
 * `/leads/new` — Server Component.
 *
 * Renders a blank `LeadForm` for creating a new lead. Pipeline stages
 * are loaded server-side so the dropdown is populated on first paint.
 * Permission gating mirrors `/leads`: `leads:read` to see the page,
 * `leads:write` to actually submit (the action enforces it again).
 */
export default async function NewLeadPage(): Promise<React.JSX.Element> {
  const session = await requireSession()

  if (!hasPermission(session.dbUser, 'leads:write')) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-md border bg-card p-6">
        <h1 className="text-lg font-semibold">New lead</h1>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to create leads in this organization.
        </p>
      </div>
    )
  }

  const pipeline = await getOrCreateDefaultPipeline(session.organizationId)

  const stages: LeadFormStage[] = pipeline.stages
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((s) => ({ id: s.id, name: s.name, order: s.order }))

  return (
    <div className="flex flex-col gap-5">
      <nav className="text-sm">
        <Link
          href="/leads"
          className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          <span>Back to leads</span>
        </Link>
      </nav>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">New lead</h1>
        <p className="text-sm text-muted-foreground">
          Add a prospect to your pipeline. Required fields are marked with an
          asterisk.
        </p>
      </header>

      <div className="rounded-md border bg-card p-5">
        <NewLeadForm stages={stages} />
      </div>
    </div>
  )
}
