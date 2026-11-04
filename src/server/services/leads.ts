import { createTenantPrisma } from '@/server/db/middleware'
import { tenantData } from '@/server/db/types'
import { leadCreateSchema, leadUpdateSchema } from '@/lib/validators/leads'
import { AppError } from '@/lib/errors'
import { getOrCreateDefaultPipeline } from '@/server/services/pipeline'
import { evaluateAssignmentRules } from '@/server/services/assignment'
import type { LeadAccessFilter } from '@/server/services/access'

/**
 * Pagination parameters for list queries.
 */
export interface PaginationParams {
  page?: number
  pageSize?: number
}

/**
 * Filter parameters for lead listing.
 */
export interface LeadFilters {
  stageId?: string
  pipelineId?: string
  assignedUserId?: string
  leadStatus?: string
  tier?: string
  search?: string
}

/**
 * Finds or creates a Company row for the given free-text company fields and
 * returns its id, so a lead can be linked via `Lead.companyId`.
 *
 * Without this, company data entered on the lead form is only stored as
 * scalar text on the Lead row and never shows up on the Companies page.
 * Matches by name within the tenant (case-insensitive); creates the company
 * when none exists yet, backfilling industry/website.
 */
async function resolveCompanyId(
  db: Pick<ReturnType<typeof createTenantPrisma>, 'company'>,
  data: {
    companyName?: string | null
    companyIndustry?: string | null
    companyWebsite?: string | null
  },
  orgId: string,
): Promise<string | undefined> {
  const name = data.companyName?.trim()
  if (!name) return undefined

  const existing = await db.company.findFirst({
    where: { name: { equals: name, mode: 'insensitive' }, organizationId: orgId },
  })
  if (existing) return existing.id

  const created = await db.company.create({
    data: {
      organizationId: orgId,
      name,
      industry: data.companyIndustry?.trim() || null,
      website: data.companyWebsite?.trim() || null,
    },
  })
  return created.id
}

/**
 * Creates a new lead within an organization.
 *
 * - Validates input with Zod (requires firstName, lastName, stageId)
 * - Persists with auto-injected organizationId via tenant middleware
 * - Ensures a default pipeline exists for the organization
 * - Links (or creates) a Company when company fields are provided so it
 *   surfaces on the Companies page
 * - For now, skips assignment rule trigger (task 11.2)
 *
 * Validates: Requirements 4.1, 4.6
 */
export async function createLead(
  data: unknown,
  userId: string,
  orgId: string,
) {
  // Validate input
  const validated = leadCreateSchema.parse(data)

  const db = createTenantPrisma(orgId)

  // Ensure a default pipeline exists (auto-creates on first lead)
  await getOrCreateDefaultPipeline(orgId)

  // Verify the stage exists within the org's pipeline
  const stage = await db.stage.findFirst({
    where: { id: validated.stageId, pipeline: { organizationId: orgId } },
  })

  if (!stage) {
    throw new AppError('STAGE_NOT_FOUND', 'The specified stage does not exist', 404)
  }

  // Link to (or create) a Company so it appears on the Companies page.
  const companyId = await resolveCompanyId(db, validated, orgId)

  // Create the lead
  // Note: organizationId is auto-injected by the tenant middleware at runtime
  const lead = await db.lead.create({
    data: tenantData({
      firstName: validated.firstName,
      lastName: validated.lastName,
      email: validated.email || null,
      altEmail: validated.altEmail || null,
      phone: validated.phone,
      title: validated.title,
      description: validated.description,
      dealValue: validated.dealValue ?? null,
      currency: validated.currency,
      score: validated.score ?? 0,
      leadStatus: validated.leadStatus ?? 'NEW',
      tier: validated.tier ?? null,
      linkedinUrl: validated.linkedinUrl || null,
      country: validated.country,
      state: validated.state,
      companyName: validated.companyName,
      companyIndustry: validated.companyIndustry,
      companyWebsite: validated.companyWebsite || null,
      companyLinkedinUrl: validated.companyLinkedinUrl || null,
      companyId: companyId ?? null,
      stageId: validated.stageId,
      isClosed: Boolean(stage.isClosedWon || stage.isClosedLost),
      closeDate: stage.isClosedWon || stage.isClosedLost ? new Date() : null,
    }),
  })

  // Trigger assignment rules if no assignee was provided
  if (!lead.assignedUserId) {
    // Run async — don't block lead creation if assignment fails
    evaluateAssignmentRules(
      {
        id: lead.id,
        assignedUserId: null,
        companyName: lead.companyName,
        country: lead.country,
        state: lead.state,
        dealValue: lead.dealValue ? Number(lead.dealValue) : null,
      },
      orgId,
    ).catch(() => {
      // Assignment rule failure is non-critical — lead is still created
    })
  }

  return lead
}

/**
 * Updates an existing lead.
 *
 * - Validates changed fields with Zod
 * - Verifies the lead belongs to the user's organization (via tenant middleware)
 *
 * Validates: Requirements 4.2
 */
export async function updateLead(
  id: string,
  data: unknown,
  userId: string,
  orgId: string,
  accessFilter: Record<string, unknown> = {},
) {
  const validated = leadUpdateSchema.parse(data)
  const db = createTenantPrisma(orgId)
  try {
    return await db.$transaction(async (tx) => {
      const where = { ...accessFilter, id, organizationId: orgId, deletedAt: null }
      const existing = await tx.lead.findFirst({ where })
      if (!existing) throw new AppError('LEAD_NOT_FOUND', 'Lead not found', 404)

      const updateData: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(validated)) {
        if (value !== undefined) {
          updateData[key] = value === '' && ['email', 'altEmail', 'linkedinUrl', 'companyWebsite', 'companyLinkedinUrl'].includes(key) ? null : value
        }
      }

      let stageChanged = false
      if (validated.stageId) {
        const stage = await tx.stage.findFirst({
          where: { id: validated.stageId, pipeline: { organizationId: orgId } },
        })
        if (!stage) throw new AppError('STAGE_NOT_FOUND', 'The specified stage does not exist', 404)
        stageChanged = stage.id !== existing.stageId
        if (stageChanged) {
          if (stage.isClosedWon && stage.isClosedLost) throw new AppError('INVALID_STAGE', 'A stage cannot be both won and lost', 400)
          const closed = Boolean(stage.isClosedWon || stage.isClosedLost)
          updateData.isClosed = closed
          updateData.closeDate = closed ? new Date() : null
        } else {
          delete updateData.stageId
        }
      }
      if (validated.companyName !== undefined) {
        updateData.companyId = (await resolveCompanyId(tx, {
          companyName: validated.companyName,
          companyIndustry: validated.companyIndustry,
          companyWebsite: validated.companyWebsite,
        }, orgId)) ?? null
      }
      if (Object.keys(updateData).length === 0) return existing

      // The source-stage predicate also prevents stale edits after a competing move.
      const lead = await tx.lead.update({
        where: { ...where, stageId: existing.stageId },
        data: updateData,
      })
      if (stageChanged) {
        await tx.stageTransition.create({
          data: { organizationId: orgId, leadId: id, fromStageId: existing.stageId, toStageId: validated.stageId!, userId },
        })
      }
      return lead
    })
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2025')
      throw new AppError('LEAD_CHANGED', 'This lead changed. Refresh before trying again.', 409)
    throw error
  }
}

/**
 * Soft-deletes a lead by setting the deletedAt timestamp.
 *
 * Idempotent: if the lead is already deleted, the deletedAt timestamp
 * is not changed.
 *
 * Validates: Requirements 4.3
 */
export async function softDeleteLead(
  id: string,
  userId: string,
  orgId: string,
  accessFilter: Record<string, unknown> = {},
) {
  const db = createTenantPrisma(orgId)
  // Retain record permissions while allowing idempotent deletion.
  const where = { ...accessFilter, id, organizationId: orgId }
  delete (where as Record<string, unknown>).deletedAt
  const existing = await db.lead.findFirst({ where })
  if (!existing) throw new AppError('LEAD_NOT_FOUND', 'Lead not found', 404)
  if (existing.deletedAt !== null) return existing
  return db.lead.update({
    where: { ...where, deletedAt: null },
    data: { deletedAt: new Date() },
  })
}

/**
 * Moves a lead to a different pipeline stage.
 *
 * - Creates a StageTransition record for audit
 * - Updates the lead's stageId
 * - Sets isClosed=true and closeDate=now() for terminal stages (isClosedWon/isClosedLost)
 * - Clears isClosed and closeDate when moving back to an open stage
 *
 * Validates: Requirements 34.3, 34.4
 */
export async function moveLead(
  id: string,
  toStageId: string,
  userId: string,
  orgId: string,
  accessFilter: Record<string, unknown> = {},
) {
  return updateLead(id, { stageId: toStageId }, userId, orgId, accessFilter)
}

/**
 * Converts a lead to a contact.
 *
 * - Creates a Contact record from lead data
 * - Moves the lead to the "Closed Won" stage
 * - Links the contact to the lead via LeadContact
 * - Exits all active cadence enrollments with reason "lead_converted"
 *
 * Validates: Requirements 29.1, 29.2, 29.3, 29.4, 29.5
 */
export async function convertToContact(
  id: string,
  userId: string,
  orgId: string,
  accessFilter: Record<string, unknown> = {},
) {
  const db = createTenantPrisma(orgId)
  try {
    return await db.$transaction(async tx => {
      const where = { ...accessFilter, id, organizationId: orgId, deletedAt: null }
      const beforeLock = await tx.lead.findFirst({ where, include: { stage: true } })
      if (!beforeLock) throw new AppError('LEAD_NOT_FOUND', 'Lead not found', 404)

      // Serialize conversions so a repeated request reuses the first contact.
      await tx.$queryRaw`SELECT "id" FROM "Lead" WHERE "id" = ${id} AND "organizationId" = ${orgId} FOR UPDATE`
      const existing = await tx.lead.findFirst({ where, include: { stage: true } })
      if (!existing || existing.stageId !== beforeLock.stageId) {
        throw new AppError('LEAD_CHANGED', 'This lead changed. Refresh before trying again.', 409)
      }
      const closedWonStage = await tx.stage.findFirst({
        where: {
          pipelineId: existing.stage.pipelineId,
          pipeline: { organizationId: orgId },
          isClosedWon: true,
          isClosedLost: false,
        },
      })
      if (!closedWonStage) {
        throw new AppError('NO_CLOSED_WON_STAGE', 'No "Closed Won" stage exists in this pipeline. Cannot convert lead.', 400)
      }
      const linked = await tx.leadContact.findFirst({
        where: { leadId: id, contact: { organizationId: orgId } },
        include: { contact: true },
      })
      const contact = linked?.contact ?? await tx.contact.create({
        data: {
          organizationId: orgId,
          firstName: existing.firstName,
          lastName: existing.lastName,
          email: existing.email,
          phone: existing.phone,
          jobTitle: existing.title,
          linkedinUrl: existing.linkedinUrl,
          country: existing.country,
          state: existing.state,
          companyId: existing.companyId,
        },
      })
      if (!linked) await tx.leadContact.create({ data: { leadId: id, contactId: contact.id } })

      const changedStage = existing.stageId !== closedWonStage.id
      const lead = changedStage || !existing.isClosed || !existing.closeDate
        ? await tx.lead.update({
            where: { ...where, stageId: existing.stageId },
            data: {
              stageId: closedWonStage.id,
              isClosed: true,
              closeDate: changedStage ? new Date() : existing.closeDate ?? new Date(),
            },
          })
        : existing
      if (changedStage) {
        await tx.stageTransition.create({
          data: {
            organizationId: orgId,
            leadId: id,
            fromStageId: existing.stageId,
            toStageId: closedWonStage.id,
            userId,
          },
        })
      }
      await tx.cadenceEnrollment.updateMany({
        where: { organizationId: orgId, leadId: id, status: 'ACTIVE' },
        data: { status: 'EXITED', exitReason: 'lead_converted' },
      })
      return { lead, contact }
    })
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2025') {
      throw new AppError('LEAD_CHANGED', 'This lead changed. Refresh before trying again.', 409)
    }
    throw error
  }
}

/**
 * Retrieves a paginated list of leads with filters and RBAC access control.
 *
 * - Excludes soft-deleted leads (deletedAt: null is part of accessFilter)
 * - Applies RBAC filter based on user's role
 *
 * Validates: Requirements 4.4
 */
export async function getLeads(
  filters: LeadFilters,
  pagination: PaginationParams,
  accessFilter: LeadAccessFilter,
  orgId: string,
) {
  const db = createTenantPrisma(orgId)

  const page = pagination.page ?? 1
  const pageSize = pagination.pageSize ?? 20
  const skip = (page - 1) * pageSize

  // Build where clause combining access filter and user filters
  const where: Record<string, unknown> = {
    ...accessFilter,
  }

  if (filters.pipelineId) where.stage = { pipelineId: filters.pipelineId }
  if (filters.stageId) {
    where.stageId = filters.stageId
  }
  if (filters.assignedUserId) {
    where.AND = [{ assignedUserId: filters.assignedUserId }]
  }
  if (filters.leadStatus) {
    where.leadStatus = filters.leadStatus
  }
  if (filters.tier) {
    where.tier = filters.tier
  }
  if (filters.search) {
    const term = filters.search.trim()
    if (term) {
      // Case-insensitive match across the fields the list surfaces.
      where.OR = [
        { firstName: { contains: term, mode: 'insensitive' } },
        { lastName: { contains: term, mode: 'insensitive' } },
        { email: { contains: term, mode: 'insensitive' } },
        { companyName: { contains: term, mode: 'insensitive' } },
      ]
    }
  }

  const [leads, total] = await Promise.all([
    db.lead.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
      include: {
        stage: true,
        assignedUser: { select: { id: true, name: true, email: true } },
      },
    }),
    db.lead.count({ where }),
  ])

  return {
    leads,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  }
}

/**
 * Retrieves a single lead by ID with related data.
 *
 * - Applies RBAC access filter
 * - Excludes soft-deleted leads
 *
 * Validates: Requirements 4.1
 */
export async function getLeadById(
  id: string,
  accessFilter: LeadAccessFilter,
  orgId: string,
) {
  const db = createTenantPrisma(orgId)

  const lead = await db.lead.findFirst({
    where: {
      id,
      ...accessFilter,
    },
    include: {
      stage: { include: { pipeline: true } },
      assignedUser: { select: { id: true, name: true, email: true } },
      company: true,
      contacts: { include: { contact: true } },
      activities: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      tasks: {
        orderBy: { dueDate: 'asc' },
        where: { isComplete: false },
        take: 5,
      },
    },
  })

  if (!lead) {
    throw new AppError('LEAD_NOT_FOUND', 'Lead not found', 404)
  }

  return lead
}
