import { createTenantPrisma } from '@/server/db/middleware'
import { tenantData } from '@/server/db/types'
import { prisma } from '@/server/db/client'
import { contactCreateSchema, companyCreateSchema } from '@/lib/validators/contacts'
import { AppError } from '@/lib/errors'

/**
 * Pagination parameters for list queries.
 */
export interface ContactPaginationParams {
  page?: number
  pageSize?: number
}

/**
 * Filter parameters for contact listing.
 */
export interface ContactFilters {
  search?: string
  companyId?: string
}

/**
 * Filter parameters for company listing.
 */
export interface CompanyFilters {
  search?: string
}

/**
 * Creates a new contact within an organization.
 *
 * - Validates input with Zod (requires firstName, lastName)
 * - Persists with auto-injected organizationId via tenant middleware
 * - Updates tsvector search field after creation
 *
 * Validates: Requirement 19.1
 */
export async function createContact(data: unknown, orgId: string) {
  const validated = contactCreateSchema.parse(data)

  const db = createTenantPrisma(orgId)

  // If companyId is provided, verify it exists within the org
  if (validated.companyId) {
    const company = await db.company.findFirst({
      where: { id: validated.companyId },
    })
    if (!company) {
      throw new AppError('COMPANY_NOT_FOUND', 'The specified company does not exist', 404)
    }
  }

  const contact = await db.contact.create({
    data: tenantData({
      firstName: validated.firstName,
      lastName: validated.lastName,
      email: validated.email || null,
      phone: validated.phone ?? null,
      jobTitle: validated.jobTitle ?? null,
      linkedinUrl: validated.linkedinUrl || null,
      country: validated.country ?? null,
      state: validated.state ?? null,
      companyId: validated.companyId ?? null,
    }),
  })

  // Update tsvector search field
  await updateContactSearchVector(contact.id)

  return contact
}

/**
 * Creates a new company within an organization.
 *
 * - Validates input with Zod (requires name)
 * - Persists with auto-injected organizationId via tenant middleware
 * - Updates tsvector search field after creation
 *
 * Validates: Requirement 19.3
 */
export async function createCompany(data: unknown, orgId: string) {
  const validated = companyCreateSchema.parse(data)

  const db = createTenantPrisma(orgId)

  const company = await db.company.create({
    data: tenantData({
      name: validated.name,
      industry: validated.industry ?? null,
      website: validated.website || null,
    }),
  })

  // Update tsvector search field
  await updateCompanySearchVector(company.id)

  return company
}

/**
 * Links a contact to a lead via the LeadContact join table.
 *
 * - Verifies both the contact and lead exist
 * - Creates the join record (composite PK: leadId + contactId)
 * - Idempotent: if the link already exists, returns the existing record
 *
 * Validates: Requirement 19.2
 */
export async function linkContactToLead(
  contactId: string,
  leadId: string,
  orgId: string,
) {
  const db = createTenantPrisma(orgId)

  // Verify contact exists within the org
  const contact = await db.contact.findFirst({
    where: { id: contactId },
  })
  if (!contact) {
    throw new AppError('CONTACT_NOT_FOUND', 'Contact not found', 404)
  }

  // Verify lead exists within the org and is not soft-deleted
  const lead = await db.lead.findFirst({
    where: { id: leadId, deletedAt: null },
  })
  if (!lead) {
    throw new AppError('LEAD_NOT_FOUND', 'Lead not found', 404)
  }

  // Create the join record using the global prisma client
  // (LeadContact is not tenant-scoped — it references tenant-scoped entities)
  try {
    const leadContact = await prisma.leadContact.create({
      data: {
        leadId,
        contactId,
      },
    })
    return leadContact
  } catch (error: any) {
    // Handle unique constraint violation (link already exists)
    if (error?.code === 'P2002') {
      // Return existing link — idempotent behavior
      return { leadId, contactId }
    }
    throw error
  }
}

/**
 * Links a lead to a company by updating the lead's companyId.
 *
 * - Verifies both the lead and company exist within the org
 * - Updates the lead's companyId field
 *
 * Validates: Requirement 19.4
 */
export async function linkLeadToCompany(
  leadId: string,
  companyId: string,
  orgId: string,
) {
  const db = createTenantPrisma(orgId)

  // Verify lead exists within the org and is not soft-deleted
  const lead = await db.lead.findFirst({
    where: { id: leadId, deletedAt: null },
  })
  if (!lead) {
    throw new AppError('LEAD_NOT_FOUND', 'Lead not found', 404)
  }

  // Verify company exists within the org
  const company = await db.company.findFirst({
    where: { id: companyId },
  })
  if (!company) {
    throw new AppError('COMPANY_NOT_FOUND', 'Company not found', 404)
  }

  // Update the lead's companyId
  const updatedLead = await db.lead.update({
    where: { id: leadId },
    data: { companyId },
  })

  return updatedLead
}

/**
 * Updates the tsvector search field on a Contact record.
 *
 * Builds a tsvector from firstName, lastName, email, and jobTitle fields
 * for full-text search support.
 *
 * Validates: Requirement 19.5
 */
async function updateContactSearchVector(contactId: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE "Contact"
     SET "searchVector" = to_tsvector('english',
       COALESCE("firstName", '') || ' ' ||
       COALESCE("lastName", '') || ' ' ||
       COALESCE("email", '') || ' ' ||
       COALESCE("jobTitle", '')
     )
     WHERE id = $1`,
    contactId,
  )
}

/**
 * Updates the tsvector search field on a Company record.
 *
 * Builds a tsvector from name, industry, and website fields
 * for full-text search support.
 *
 * Validates: Requirement 19.5
 */
async function updateCompanySearchVector(companyId: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE "Company"
     SET "searchVector" = to_tsvector('english',
       COALESCE("name", '') || ' ' ||
       COALESCE("industry", '') || ' ' ||
       COALESCE("website", '')
     )
     WHERE id = $1`,
    companyId,
  )
}

/**
 * Lists contacts within an organization with pagination and optional filters.
 *
 * Validates: Requirement 19.1
 */
export async function getContacts(
  filters: ContactFilters,
  pagination: ContactPaginationParams,
  orgId: string,
) {
  const db = createTenantPrisma(orgId)
  const page = pagination.page ?? 1
  const pageSize = pagination.pageSize ?? 20
  const skip = (page - 1) * pageSize

  const where: Record<string, unknown> = {}

  if (filters.companyId) {
    where.companyId = filters.companyId
  }

  if (filters.search) {
    where.OR = [
      { firstName: { contains: filters.search, mode: 'insensitive' } },
      { lastName: { contains: filters.search, mode: 'insensitive' } },
      { email: { contains: filters.search, mode: 'insensitive' } },
    ]
  }

  const [contacts, total] = await Promise.all([
    db.contact.findMany({
      where,
      include: {
        company: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    db.contact.count({ where }),
  ])

  return {
    contacts,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  }
}

/**
 * Gets a single contact by ID within an organization.
 *
 * Validates: Requirement 19.1
 */
export async function getContactById(id: string, orgId: string) {
  const db = createTenantPrisma(orgId)

  const contact = await db.contact.findFirst({
    where: { id },
    include: {
      company: { select: { id: true, name: true } },
      leads: {
        include: {
          lead: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  })

  if (!contact) {
    throw new AppError('CONTACT_NOT_FOUND', 'Contact not found', 404)
  }

  return contact
}

/**
 * Updates an existing contact.
 *
 * Validates: Requirement 19.1
 */
export async function updateContact(id: string, data: unknown, orgId: string) {
  const validated = contactCreateSchema.partial().parse(data)

  const db = createTenantPrisma(orgId)

  // Verify contact exists
  const existing = await db.contact.findFirst({ where: { id } })
  if (!existing) {
    throw new AppError('CONTACT_NOT_FOUND', 'Contact not found', 404)
  }

  // If companyId is provided, verify it exists within the org
  if (validated.companyId) {
    const company = await db.company.findFirst({
      where: { id: validated.companyId },
    })
    if (!company) {
      throw new AppError('COMPANY_NOT_FOUND', 'The specified company does not exist', 404)
    }
  }

  const contact = await db.contact.update({
    where: { id },
    data: {
      ...(validated.firstName !== undefined && { firstName: validated.firstName }),
      ...(validated.lastName !== undefined && { lastName: validated.lastName }),
      ...(validated.email !== undefined && { email: validated.email || null }),
      ...(validated.phone !== undefined && { phone: validated.phone ?? null }),
      ...(validated.jobTitle !== undefined && { jobTitle: validated.jobTitle ?? null }),
      ...(validated.linkedinUrl !== undefined && { linkedinUrl: validated.linkedinUrl || null }),
      ...(validated.country !== undefined && { country: validated.country ?? null }),
      ...(validated.state !== undefined && { state: validated.state ?? null }),
      ...(validated.companyId !== undefined && { companyId: validated.companyId ?? null }),
    },
  })

  // Update tsvector search field
  await updateContactSearchVector(contact.id)

  return contact
}

/**
 * Deletes a contact by ID.
 *
 * Validates: Requirement 19.1
 */
export async function deleteContact(id: string, orgId: string) {
  const db = createTenantPrisma(orgId)

  // Verify contact exists
  const existing = await db.contact.findFirst({ where: { id } })
  if (!existing) {
    throw new AppError('CONTACT_NOT_FOUND', 'Contact not found', 404)
  }

  // Delete associated LeadContact records first
  await prisma.leadContact.deleteMany({ where: { contactId: id } })

  // Delete the contact
  await db.contact.delete({ where: { id } })

  return { id }
}

/**
 * Lists companies within an organization with pagination and optional filters.
 *
 * Validates: Requirement 19.3
 */
export async function getCompanies(
  filters: CompanyFilters,
  pagination: ContactPaginationParams,
  orgId: string,
) {
  const db = createTenantPrisma(orgId)
  const page = pagination.page ?? 1
  const pageSize = pagination.pageSize ?? 20
  const skip = (page - 1) * pageSize

  const where: Record<string, unknown> = {}

  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: 'insensitive' } },
      { industry: { contains: filters.search, mode: 'insensitive' } },
    ]
  }

  const [companies, total] = await Promise.all([
    db.company.findMany({
      where,
      include: {
        _count: { select: { contacts: true, leads: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    db.company.count({ where }),
  ])

  return {
    companies,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  }
}

/**
 * Gets a single company by ID within an organization.
 *
 * Validates: Requirement 19.3
 */
export async function getCompanyById(id: string, orgId: string) {
  const db = createTenantPrisma(orgId)

  const company = await db.company.findFirst({
    where: { id },
    include: {
      contacts: {
        select: { id: true, firstName: true, lastName: true, email: true, jobTitle: true },
        orderBy: { createdAt: 'desc' },
      },
      _count: { select: { contacts: true, leads: true } },
    },
  })

  if (!company) {
    throw new AppError('COMPANY_NOT_FOUND', 'Company not found', 404)
  }

  return company
}

/**
 * Updates an existing company.
 *
 * Validates: Requirement 19.3
 */
export async function updateCompany(id: string, data: unknown, orgId: string) {
  const validated = companyCreateSchema.partial().parse(data)

  const db = createTenantPrisma(orgId)

  // Verify company exists
  const existing = await db.company.findFirst({ where: { id } })
  if (!existing) {
    throw new AppError('COMPANY_NOT_FOUND', 'Company not found', 404)
  }

  const company = await db.company.update({
    where: { id },
    data: {
      ...(validated.name !== undefined && { name: validated.name }),
      ...(validated.industry !== undefined && { industry: validated.industry ?? null }),
      ...(validated.website !== undefined && { website: validated.website || null }),
    },
  })

  // Update tsvector search field
  await updateCompanySearchVector(company.id)

  return company
}

/**
 * Deletes a company by ID.
 *
 * Validates: Requirement 19.3
 */
export async function deleteCompany(id: string, orgId: string) {
  const db = createTenantPrisma(orgId)

  // Verify company exists
  const existing = await db.company.findFirst({ where: { id } })
  if (!existing) {
    throw new AppError('COMPANY_NOT_FOUND', 'Company not found', 404)
  }

  // Unlink contacts from this company
  await db.contact.updateMany({
    where: { companyId: id },
    data: { companyId: null },
  })

  // Unlink leads from this company
  await db.lead.updateMany({
    where: { companyId: id },
    data: { companyId: null },
  })

  // Delete the company
  await db.company.delete({ where: { id } })

  return { id }
}
