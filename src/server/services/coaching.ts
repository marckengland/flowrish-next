import { createTenantPrisma } from '@/server/db/middleware'
import { tenantData } from '@/server/db/types'
import { AppError } from '@/lib/errors'
import type { SessionUser } from '@/server/auth/session'

/**
 * Adds a coaching comment to an activity.
 *
 * - Creates a CoachingComment record linked to the activity
 * - Supports optional @mention via mentionedUserId
 * - organizationId is auto-injected by tenant middleware
 *
 * Validates: Requirements 30.1, 30.3
 */
export async function addComment(
  activityId: string,
  authorId: string,
  content: string,
  mentionedUserId: string | undefined,
  orgId: string,
) {
  const db = createTenantPrisma(orgId)

  // Verify the activity exists within the organization
  const activity = await db.activity.findFirst({
    where: { id: activityId },
  })

  if (!activity) {
    throw new AppError('ACTIVITY_NOT_FOUND', 'Activity not found', 404)
  }

  // Validate content is non-empty
  if (!content || content.trim().length === 0) {
    throw new AppError('INVALID_CONTENT', 'Comment content cannot be empty', 400)
  }

  // If mentionedUserId is provided, verify the user exists
  if (mentionedUserId) {
    const { prisma } = await import('@/server/db/client')
    const mentionedUser = await prisma.user.findUnique({
      where: { id: mentionedUserId },
    })

    if (!mentionedUser) {
      throw new AppError('USER_NOT_FOUND', 'Mentioned user not found', 404)
    }
  }

  const comment = await db.coachingComment.create({
    data: tenantData({
      activityId,
      authorId,
      content: content.trim(),
      mentionedUserId: mentionedUserId ?? null,
    }),
  })

  return comment
}

/**
 * Retrieves coaching comments for an activity, sorted by createdAt ascending.
 *
 * Access control:
 * - OWNER/ADMIN/MANAGER: can see comments on any activity in the org
 * - MEMBER: can only see comments on activities belonging to their own leads
 *
 * Validates: Requirements 30.2, 30.4
 */
export async function getComments(
  activityId: string,
  orgId: string,
  user?: SessionUser,
) {
  const db = createTenantPrisma(orgId)

  // Verify the activity exists within the organization
  const activity = await db.activity.findFirst({
    where: { id: activityId },
    select: {
      id: true,
      leadId: true,
    },
  })

  if (!activity) {
    throw new AppError('ACTIVITY_NOT_FOUND', 'Activity not found', 404)
  }

  // MEMBER access: only see comments on their own activities (activities on leads assigned to them)
  if (user) {
    const highestPrivilege = getHighestPrivilege(user)

    if (highestPrivilege >= 3) {
      // MEMBER role — verify the activity belongs to a lead assigned to them
      const lead = await db.lead.findFirst({
        where: {
          id: activity.leadId,
          assignedUserId: user.id,
          deletedAt: null,
        },
      })

      if (!lead) {
        throw new AppError(
          'FORBIDDEN',
          'You can only view comments on your own activities',
          403,
        )
      }
    }
  }

  const comments = await db.coachingComment.findMany({
    where: { activityId },
    orderBy: { createdAt: 'asc' },
    include: {
      author: {
        select: {
          id: true,
          name: true,
          email: true,
          avatarUrl: true,
        },
      },
    },
  })

  return comments
}

/**
 * Determines the highest privilege level (lowest hierarchy number)
 * across all of the user's team memberships.
 */
function getHighestPrivilege(user: SessionUser): number {
  if (user.teamMemberships.length === 0) {
    return Infinity
  }

  return Math.min(...user.teamMemberships.map((m) => m.role.hierarchy))
}
