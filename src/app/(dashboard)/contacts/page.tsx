import { requireSession } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { getContacts } from '@/server/services/contacts'
import { getCompanies } from '@/server/services/contacts'
import { ContactTable } from '@/components/contacts/contact-table'
import { ContactCreateDialog } from '@/components/contacts/contact-create-dialog'
import type { ContactListItem } from '@/hooks/use-contacts'

/**
 * Contacts list page — Server Component.
 *
 * Responsibilities:
 * 1. Require an authenticated session and `contacts:read` permission.
 * 2. Pre-fetch the first page of contacts so the table paints immediately.
 * 3. Load companies for the create form's company dropdown.
 * 4. TanStack Query takes over on subsequent filter/page changes.
 *
 * Validates: Requirements 19.1, 19.3
 */
export default async function ContactsPage(): Promise<React.JSX.Element> {
  const session = await requireSession()

  if (!hasPermission(session.dbUser, 'contacts:read')) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-md border bg-card p-6">
        <h1 className="text-lg font-semibold">Contacts</h1>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view contacts in this organization.
        </p>
      </div>
    )
  }

  const canWrite = hasPermission(session.dbUser, 'contacts:write')

  // Pre-fetch first page of contacts and companies for the form dropdown
  const [contactsResult, companiesResult] = await Promise.all([
    getContacts({}, { page: 1, pageSize: 20 }, session.organizationId),
    getCompanies({}, { page: 1, pageSize: 100 }, session.organizationId),
  ])

  const initialData = {
    data: contactsResult.contacts.map(toContactListItem),
    pagination: contactsResult.pagination,
  }

  const companyOptions = companiesResult.companies.map((c) => ({
    id: c.id,
    name: c.name,
  }))

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
          <p className="text-sm text-muted-foreground">
            Manage contacts linked to your leads and companies.
          </p>
        </div>
        {canWrite && <ContactCreateDialog companies={companyOptions} />}
      </header>

      <ContactTable initialData={initialData} page={1} pageSize={20} />
    </div>
  )
}

/**
 * Normalizes a Prisma Contact into the JSON-serializable shape the
 * ContactTable expects.
 */
function toContactListItem(
  contact: Awaited<ReturnType<typeof getContacts>>['contacts'][number],
): ContactListItem {
  return {
    id: contact.id,
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: (contact as any).email ?? null,
    phone: (contact as any).phone ?? null,
    jobTitle: (contact as any).jobTitle ?? null,
    linkedinUrl: (contact as any).linkedinUrl ?? null,
    country: (contact as any).country ?? null,
    state: (contact as any).state ?? null,
    companyId: (contact as any).companyId ?? null,
    company: (contact as any).company ?? null,
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString(),
  }
}
