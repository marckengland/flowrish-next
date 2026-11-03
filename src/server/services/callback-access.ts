import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/server/db/client'
import { AppError } from '@/lib/errors'
// Current local team-role union, matching getEffectivePermissions semantics.
export function callbackRecipientsSql(organizationId: string, userId?: string) {
  return Prisma.sql`SELECT m."userId", COALESCE(bool_or(p.key='admin:settings'),false) AS admin,
    COALESCE(bool_or(p.key='leads:read') AND bool_or(p.key='leads:write'),false) AS crm
    FROM "OrganizationMember" m LEFT JOIN "TeamMember" tm ON tm."userId"=m."userId"
    LEFT JOIN "Team" t ON t.id=tm."teamId" AND t."organizationId"=${organizationId}
    LEFT JOIN "RolePermission" p ON p."roleId"=tm."roleId" AND t.id IS NOT NULL
    WHERE m."organizationId"=${organizationId} ${userId ? Prisma.sql`AND m."userId"=${userId}` : Prisma.empty} GROUP BY m."userId"`
}
export async function callbackAccess(organizationId: string, userId: string, db: Prisma.TransactionClient = prisma) {
  const [access] = await db.$queryRaw<Array<{ userId: string; admin: boolean; crm: boolean }>>`${callbackRecipientsSql(organizationId, userId)}`
  if (!access) throw new AppError('FORBIDDEN', 'Current organization membership is required.', 403)
  return access
}
