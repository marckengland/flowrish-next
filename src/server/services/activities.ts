import { createTenantPrisma } from '@/server/db/middleware'
import { activityCreateSchema } from '@/lib/validators/activities'
import { AppError } from '@/lib/errors'

/**
 * Creates a new activity for a lead within an organization.
 *
 * - Validates input with Zod (requires type, leadId)
 * - Persists the activity with auto-injected organizationId via tenant middleware
 * - Updates the lead's `lastActivityAt` field to the current timestamp
 * - Supports types: CALL (callDate, callDuration), MEETING (meetingDate, attendees), NOTE, EMAIL, FILE_ATTACHMENT
 *
 * Validates: Requirements 5.1, 5.2, 5.3
 */
export async function createActivity(
  data: unknown,
  userId: string,
  orgId: string,
) {
  // Validate input
  const validated = activityCreateSchema.parse(data)

  const db = createTenantPrisma(orgId)

  // Verify the lead exists and is not soft-deleted
  const lead = await db.lead.findFirst({
    where: { id: validated.leadId, deletedAt: null },
  })

  if (!lead) {
    throw new AppError('LEAD_NOT_FOUND', 'Lead not found', 404)
  }

  // Build activity data based on type
  const activityData: Record<string, unknown> = {
    type: validated.type,
    leadId: validated.leadId,
    createdById: userId,
    notes: validated.notes ?? null,
  }

  // Add type-specific fields
  switch (validated.type) {
    case 'CALL':
      activityData.callDate = validated.callDate ?? null
      activityData.callDuration = validated.callDuration ?? null
      break
    case 'MEETING':
      activityData.meetingDate = validated.meetingDate ?? null
      activityData.attendees = validated.attendees
        ? JSON.stringify(validated.attendees)
        : null
      break
    case 'NOTE':
    case 'EMAIL':
    case 'FILE_ATTACHMENT':
      // No additional type-specific fields required
      break
  }

  // Create the activity
  const activity = await db.activity.create({
    data: activityData as any,
  })

  // Update the lead's lastActivityAt to the current timestamp
  await db.lead.update({
    where: { id: validated.leadId },
    data: { lastActivityAt: new Date() },
  })

  return activity
}

/**
 * Retrieves all activities for a lead, sorted by createdAt descending (newest first).
 *
 * Validates: Requirements 5.4
 */
export async function getActivitiesByLead(
  leadId: string,
  orgId: string,
) {
  const db = createTenantPrisma(orgId)

  // Verify the lead exists and is not soft-deleted
  const lead = await db.lead.findFirst({
    where: { id: leadId, deletedAt: null },
  })

  if (!lead) {
    throw new AppError('LEAD_NOT_FOUND', 'Lead not found', 404)
  }

  const activities = await db.activity.findMany({
    where: { leadId },
    orderBy: { createdAt: 'desc' },
  })

  return activities
}
