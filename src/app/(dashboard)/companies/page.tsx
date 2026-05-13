import { requireSession } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { getCompanies } from '@/server/services/contacts'
import { CompanyTable } from '@/components/companies/company-table'
import { CompanyCreateDialog } from '@/components/companies/company-create-dialog'
import type { CompanyListItem } from '@/hooks/use-companies'

/**
 * Companies list page — Server Component.
 *
 * Responsibilities:
 * 1. Require an authenticated session and `contacts:read` permission.
 * 2. Pre-fetch the first page of companies so the table paints immediately.
 * 3. TanStack Query takes over on subsequent filter/page changes.
 *
 * Validates: Requirements 19.3
 */
export default async function CompaniesPage(): Promise<React.JSX.Element> {
  const session = await requireSession()

  if (!hasPermission(session.dbUser, 'contacts:read')) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-md border bg-card p-6">
        <h1 className="text-lg font-semibold">Companies</h1>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view companies in this organization.
        </p>
      </div>
    )
  }

  const canWrite = hasPermission(session.dbUser, 'contacts:write')

  // Pre-fetch first page of companies
  const companiesResult = await getCompanies(
    {},
    { page: 1, pageSize: 20 },
    session.organizationId,
  )

  const initialData = {
    data: companiesResult.companies.map(toCompanyListItem),
    pagination: companiesResult.pagination,
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Companies</h1>
          <p className="text-sm text-muted-foreground">
            Manage companies and track their linked contacts and leads.
          </p>
        </div>
        {canWrite && <CompanyCreateDialog />}
      </header>

      <CompanyTable initialData={initialData} page={1} pageSize={20} />
    </div>
  )
}

/**
 * Normalizes a Prisma Company into the JSON-serializable shape the
 * CompanyTable expects.
 */
function toCompanyListItem(
  company: Awaited<ReturnType<typeof getCompanies>>['companies'][number],
): CompanyListItem {
  return {
    id: company.id,
    name: company.name,
    industry: (company as any).industry ?? null,
    website: (company as any).website ?? null,
    createdAt: company.createdAt.toISOString(),
    updatedAt: company.updatedAt.toISOString(),
    _count: (company as any)._count ?? { contacts: 0, leads: 0 },
  }
}
