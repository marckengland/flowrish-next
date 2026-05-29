import { notFound } from 'next/navigation'

import { requireSession } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { createTenantPrisma } from '@/server/db/middleware'
import { CompanyDetailView } from '@/components/companies/company-detail'

/**
 * Company detail page — Server Component.
 *
 * Fetches the company, every linked contact, and the most recent leads
 * (capped at 50 — large rosters fall back to the lead list page where
 * the user can filter properly). The total lead count is surfaced so
 * the delete-confirm dialog can warn accurately even when only a slice
 * is rendered.
 *
 * Validates: Requirements 19.3, 19.4
 */
export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<React.JSX.Element> {
  const { id } = await params
  const session = await requireSession()

  if (!hasPermission(session.dbUser, 'contacts:read')) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-md border bg-card p-6">
        <h1 className="text-lg font-semibold">Company</h1>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view companies in this organization.
        </p>
      </div>
    )
  }

  const canManage = hasPermission(session.dbUser, 'contacts:write')

  const db = createTenantPrisma(session.organizationId)
  const company = await db.company.findFirst({
    where: { id },
    include: {
      contacts: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          jobTitle: true,
        },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      },
      leads: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          dealValue: true,
          currency: true,
          stage: { select: { id: true, name: true } },
        },
        where: { deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        take: 50,
      },
      _count: { select: { leads: true } },
    },
  })

  if (!company) {
    notFound()
  }

  return (
    <CompanyDetailView
      company={{
        id: company.id,
        name: company.name,
        industry: company.industry ?? null,
        website: company.website ?? null,
      }}
      contacts={company.contacts}
      leads={company.leads.map((lead) => ({
        id: lead.id,
        firstName: lead.firstName,
        lastName: lead.lastName,
        dealValue: lead.dealValue === null ? null : Number(lead.dealValue),
        currency: lead.currency,
        stage: lead.stage,
      }))}
      leadCount={company._count.leads}
      canManage={canManage}
    />
  )
}
