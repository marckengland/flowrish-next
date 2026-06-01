import { notFound } from 'next/navigation'

import { requireSession } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { getContactById } from '@/server/services/contacts'
import { AppError } from '@/lib/errors'

import { ContactDetailView } from '@/components/contacts/contact-detail'

/**
 * Contact detail page — Server Component.
 *
 * Loads a single contact by id within the user's organization, then
 * hands a fully serialized payload to the client view. Mirrors the
 * permission and 404 patterns from `companies/[id]` and `leads/[id]`.
 *
 * Validates: Requirement 19.1
 */
export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<React.JSX.Element> {
  const { id } = await params
  const session = await requireSession()

  if (!hasPermission(session.dbUser, 'contacts:read')) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-md border bg-card p-6">
        <h1 className="text-lg font-semibold">Contact</h1>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view contacts in this organization.
        </p>
      </div>
    )
  }

  const canManage = hasPermission(session.dbUser, 'contacts:write')

  let contact
  try {
    contact = await getContactById(id, session.organizationId)
  } catch (err) {
    if (err instanceof AppError && err.code === 'CONTACT_NOT_FOUND') {
      notFound()
    }
    throw err
  }

  return (
    <ContactDetailView
      contact={{
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email ?? null,
        phone: contact.phone ?? null,
        jobTitle: contact.jobTitle ?? null,
        linkedinUrl: contact.linkedinUrl ?? null,
        country: contact.country ?? null,
        state: contact.state ?? null,
        company: contact.company,
      }}
      leads={contact.leads.map((entry) => ({
        id: entry.lead.id,
        firstName: entry.lead.firstName,
        lastName: entry.lead.lastName,
      }))}
      canManage={canManage}
    />
  )
}
