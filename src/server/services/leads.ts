import { createTenantPrisma } from '@/server/db/middleware'
import { tenantData } from '@/server/db/types'
import { leadCreateSchema, leadUpdateSchema } from '@/lib/validators/leads'
import { AppError } from '@/lib/errors'
import { getOrCreateDefaultPipeline, createStageTransition } from '@/server/services/pipeline'
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
  assignedUserId?: string
  leadStatus?: string
  tier?: string
  search?: string
}

/**
 * Creates a new lead within an organization.
 *
 * - Validates input with Zod (requires firstName, lastName, stageId)
 * - Persists with auto-injected organizationId via tenant middleware
 * - Ensures a default pipeline exists for the organization
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
    where: { id: validated.stageId },
  })

  if (!stage) {
    throw new AppError('STAGE_NOT_FOUND', 'The specified stage does not exist', 404)
  }

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
      stageId: validated.stageId,
      // Assignment rules will be triggered in task 11.2
      // For now, leave unassigned if no assignee provided
    }),
  })

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
) {
  // Validate input (all fields optional)
  const validated = leadUpdateSchema.parse(data)

  const db = createTenantPrisma(orgId)

  // Verify lead exists within the org (tenant middleware enforces org ownership)
  const existing = await db.lead.findFirst({
    where: { id, deletedAt: null },
  })

  if (!existing) {
    throw new AppError('LEAD_NOT_FOUND', 'Lead not found', 404)
  }

  // If stageId is being changed, verify the new stage exists
  if (validated.stageId) {
    const stage = await db.stage.findFirst({
      where: { id: validated.stageId },
    })

    if (!stage) {
      throw new AppError('STAGE_NOT_FOUND', 'The specified stage does not exist', 404)
    }
  }

  // Build update data, only including defined fields
  const updateData: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(validated)) {
    if (value !== undefined) {
      // Convert empty strings to null for optional URL/email fields
      if (value === '' && ['email', 'altEmail', 'linkedinUrl', 'companyWebsite'].includes(key)) {
        updateData[key] = null
      } else {
        updateData[key] = value
      }
    }
  }

  const lead = await db.lead.update({
    where: { id },
    data: updateData,
  })

  return lead
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
) {
  const db = createTenantPrisma(orgId)

  // Find the lead (including already-deleted ones to check idempotency)
  const existing = await db.lead.findFirst({
    where: { id },
  })

  if (!existing) {
    throw new AppError('LEAD_NOT_FOUND', 'Lead not found', 404)
  }

  // Idempotent: don't change deletedAt if already deleted
  if (existing.deletedAt !== null) {
    return existing
  }

  const lead = await db.lead.update({
    where: { id },
    data: { deletedAt: new Date() },
  })

  return lead
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
) {
  const db = createTenantPrisma(orgId)

  // Verify lead exists and is not deleted
  const existing = await db.lead.findFirst({
    where: { id, deletedAt: null },
  })

  if (!existing) {
    throw new AppError('LEAD_NOT_FOUND', 'Lead not found', 404)
  }

  // Verify the target stage exists
  const toStage = await db.stage.findFirst({
    where: { id: toStageId },
  })

  if (!toStage) {
    throw new AppError('STAGE_NOT_FOUND', 'The target stage does not exist', 404)
  }

  // Determine if the target stage is terminal
  const isTerminal = toStage.isClosedWon || toStage.isClosedLost

  // Create stage transition record
  await createStageTransition(id, existing.stageId, toStageId, userId, db)

  // Update lead with new stage and closed state
  const lead = await db.lead.update({
    where: { id },
    data: {
      stageId: toStageId,
      isClosed: isTerminal,
      closeDate: isTerminal ? new Date() : null,
    },
  })

  return lead
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
) {
  const db = createTenantPrisma(orgId)

  // Verify lead exists and is not deleted
  const existing = await db.lead.findFirst({
    where: { id, deletedAt: null },
    include: { stage: { include: { pipeline: true } } },
  })

  if (!existing) {
    throw new AppError('LEAD_NOT_FOUND', 'Lead not found', 404)
  }

  // Find the "Closed Won" stage in the lead's pipeline
  const closedWonStage = await db.stage.findFirst({
    where: {
      pipelineId: existing.stage.pipelineId,
      isClosedWon: true,
    },
  })

  if (!closedWonStage) {
    throw new AppError(
      'NO_CLOSED_WON_STAGE',
      'No "Closed Won" stage exists in this pipeline. Cannot convert lead.',
      400,
    )
  }

  // Create contact from lead data
  // Note: organizationId is auto-injected by the tenant middleware at runtime
  const contact = await db.contact.create({
    data: tenantData({
      firstName: existing.firstName,
      lastName: existing.lastName,
      email: existing.email,
      phone: existing.phone,
      jobTitle: existing.title,
      linkedinUrl: existing.linkedinUrl,
      country: existing.country,
      state: existing.state,
      companyId: existing.companyId,
    }),
  })

  // Link contact to lead via LeadContact
  const { prisma } = await import('@/server/db/client')
  await prisma.leadContact.create({
    data: {
      leadId: id,
      contactId: contact.id,
    },
  })

  // Move lead to Closed Won stage
  await createStageTransition(id, existing.stageId, closedWonStage.id, userId, db)

  const lead = await db.lead.update({
    where: { id },
    data: {
      stageId: closedWonStage.id,
      isClosed: true,
      closeDate: new Date(),
    },
  })

  // Exit all active cadence enrollments for this lead
  await db.cadenceEnrollment.updateMany({
    where: {
      leadId: id,
      status: 'ACTIVE',
    },
    data: {
      status: 'EXITED',
      exitReason: 'lead_converted',
    },
  })

  return { lead, contact }
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

  if (filters.stageId) {
    where.stageId = filters.stageId
  }
  if (filters.assignedUserId) {
    where.assignedUserId = filters.assignedUserId
  }
  if (filters.leadStatus) {
    where.leadStatus = filters.leadStatus
  }
  if (filters.tier) {
    where.tier = filters.tier
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
