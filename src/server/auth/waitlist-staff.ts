import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/server/db/client'
import { AppError } from '@/lib/errors'

export type WaitlistDb = Prisma.TransactionClient
const denied = () =>
  new AppError('FORBIDDEN', 'Flowrish staff access is required.', 403)

export async function hasWaitlistStaffAccess(
  organizationId: string,
  userId: string,
  db: WaitlistDb = prisma,
): Promise<boolean> {
  const grant = await db.waitlistStaffAccess.findFirst({
    where: { membership: { organizationId, userId } },
    select: { membershipId: true },
  })
  return Boolean(grant)
}

export async function assertWaitlistStaff(
  organizationId: string,
  userId: string,
  db: WaitlistDb = prisma,
): Promise<void> {
  if (!(await hasWaitlistStaffAccess(organizationId, userId, db)))
    throw denied()
}

export async function lockWaitlistStaff(
  organizationId: string,
  userId: string,
  db: WaitlistDb,
): Promise<void> {
  const rows = await db.$queryRaw<
    { membershipId: string }[]
  >`SELECT g."membershipId" FROM "WaitlistStaffAccess" g JOIN "OrganizationMember" m ON m.id=g."membershipId" WHERE m."organizationId"=${organizationId} AND m."userId"=${userId} FOR SHARE OF g,m`
  if (!rows.length) throw denied()
  await assertWaitlistStaff(organizationId, userId, db)
}
