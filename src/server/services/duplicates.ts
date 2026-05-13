import { createTenantPrisma } from '@/server/db/middleware'
import { prisma } from '@/server/db/client'
import { AppError } from '@/lib/errors'

/**
 * Represents a potential duplicate match found during detection.
 */
export interface DuplicateMatch {
  leadId: string
  leadName: string
  matchType: 'email' | 'company'
  matchValue: string
}

/**
 * Checks for potential duplicate leads by contact email (case-insensitive)
 * and/or company name (case-insensitive).
 *
 * Searches the lead's direct email field and linked contacts' emails for
 * email matches, and the lead's companyName field for company matches.
 * Only non-deleted leads are considered.
 *
 * Validates: Requirements 27.1, 27.2
 */
export async function checkDuplicates(
  contactEmail: string | undefined,
  companyName: string | undefined,
  orgId: string,
): Promise<DuplicateMatch[]> {
  const db = createTenantPrisma(orgId)
  const matches: DuplicateMatch[] = []

  // Check by contact email (case-insensitive)
  if (contactEmail && contactEmail.trim() !== '') {
    const emailTrimmed = contactEmail.trim()

    // Search leads by direct email field
    const directEmailMatches = await db.lead.findMany({
      where: {
        deletedAt: null,
        email: { equals: emailTrimmed, mode: 'insensitive' },
      },
      select: { id: true, firstName: true, lastName: true, email: true },
    })

    for (const lead of directEmailMatches) {
      matches.push({
        leadId: lead.id,
        leadName: `${lead.firstName} ${lead.lastName}`.trim(),
        matchType: 'email',
        matchValue: lead.email ?? emailTrimmed,
      })
    }

    // Search leads by linked contact email
    const contactEmailMatches = await db.lead.findMany({
      where: {
        deletedAt: null,
        contacts: {
          some: {
            contact: {
              email: { equals: emailTrimmed, mode: 'insensitive' },
            },
          },
        },
      },
      select: { id: true, firstName: true, lastName: true },
    })

    for (const lead of contactEmailMatches) {
      // Avoid duplicate entries if same lead matched by both direct and contact email
      if (!matches.some((m) => m.leadId === lead.id)) {
        matches.push({
          leadId: lead.id,
          leadName: `${lead.firstName} ${lead.lastName}`.trim(),
          matchType: 'email',
          matchValue: emailTrimmed,
        })
      }
    }
  }

  // Check by company name (case-insensitive)
  if (companyName && companyName.trim() !== '') {
    const companyNameTrimmed = companyName.trim()

    const companyMatches = await db.lead.findMany({
      where: {
        deletedAt: null,
        companyName: { equals: companyNameTrimmed, mode: 'insensitive' },
      },
      select: { id: true, firstName: true, lastName: true, companyName: true },
    })

    for (const lead of companyMatches) {
      // Avoid duplicate entries if same lead matched by both email and company
      if (!matches.some((m) => m.leadId === lead.id)) {
        matches.push({
          leadId: lead.id,
          leadName: `${lead.firstName} ${lead.lastName}`.trim(),
          matchType: 'company',
          matchValue: lead.companyName ?? companyNameTrimmed,
        })
      }
    }
  }

  return matches
}

/**
 * Merges a secondary lead into a primary lead within a single transaction.
 *
 * - Moves all activities from secondary to primary
 * - Moves contacts from secondary to primary (skips existing links)
 * - Deletes the secondary lead
 * - Primary lead retains its stage, score, assigned user, and all other fields
 *
 * Rejects self-merge (primaryLeadId === secondaryLeadId).
 *
 * Validates: Requirements 27.3, 27.4, 27.5, 27.6
 */
export async function mergeLeads(
  primaryLeadId: string,
  secondaryLeadId: string,
  orgId: string,
) {
  // Reject self-merge
  if (primaryLeadId === secondaryLeadId) {
    throw new AppError(
      'SELF_MERGE',
      'Cannot merge a lead with itself',
      400,
    )
  }

  const db = createTenantPrisma(orgId)

  // Verify both leads exist and are not deleted
  const [primaryLead, secondaryLead] = await Promise.all([
    db.lead.findFirst({
      where: { id: primaryLeadId, deletedAt: null },
    }),
    db.lead.findFirst({
      where: { id: secondaryLeadId, deletedAt: null },
    }),
  ])

  if (!primaryLead) {
    throw new AppError('LEAD_NOT_FOUND', 'Primary lead not found', 404)
  }

  if (!secondaryLead) {
    throw new AppError('LEAD_NOT_FOUND', 'Secondary lead not found', 404)
  }

  // Get existing contacts on the primary lead to avoid duplicate links
  const existingContacts = await prisma.leadContact.findMany({
    where: { leadId: primaryLeadId },
    select: { contactId: true },
  })
  const existingContactIds = new Set(existingContacts.map((c) => c.contactId))

  // Get contacts from secondary lead
  const secondaryContacts = await prisma.leadContact.findMany({
    where: { leadId: secondaryLeadId },
    select: { contactId: true },
  })

  const newContactIds = secondaryContacts
    .map((c) => c.contactId)
    .filter((id) => !existingContactIds.has(id))

  // Perform merge in a transaction
  const mergedLead = await prisma.$transaction(async (tx) => {
    // Move all activities from secondary to primary
    await tx.activity.updateMany({
      where: { leadId: secondaryLeadId },
      data: { leadId: primaryLeadId },
    })

    // Create new contact links for contacts not already on primary
    for (const contactId of newContactIds) {
      await tx.leadContact.create({
        data: { leadId: primaryLeadId, contactId },
      })
    }

    // Remove old contact links from secondary lead
    await tx.leadContact.deleteMany({
      where: { leadId: secondaryLeadId },
    })

    // Delete the secondary lead
    await tx.lead.delete({
      where: { id: secondaryLeadId },
    })

    // Return the updated primary lead with relations
    return tx.lead.findUnique({
      where: { id: primaryLeadId },
      include: {
        stage: true,
        assignedUser: { select: { id: true, name: true, email: true } },
        company: true,
        contacts: { include: { contact: true } },
        activities: {
          orderBy: { createdAt: 'desc' },
        },
      },
    })
  })

  return mergedLead
}
