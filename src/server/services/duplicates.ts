import { createTenantPrisma } from '@/server/db/middleware'
import type { LeadAccessFilter } from './access'

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
  accessFilter: LeadAccessFilter,
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
        organizationId: orgId,
        AND: [accessFilter],
        email: { equals: emailTrimmed, mode: 'insensitive' },
      },
      take: 50,
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
        organizationId: orgId,
        AND: [accessFilter],
        contacts: {
          some: {
            contact: {
              email: { equals: emailTrimmed, mode: 'insensitive' },
            },
          },
        },
      },
      take: 50,
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
        organizationId: orgId,
        AND: [accessFilter],
        companyName: { equals: companyNameTrimmed, mode: 'insensitive' },
      },
      take: 50,
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

  return matches.slice(0, 50)
}
