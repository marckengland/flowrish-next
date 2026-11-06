import 'server-only'
import { memberTaskScope } from './task-access'
import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'
import { AppError } from '@/lib/errors'
import { hasPermission, requirePermission } from '@/server/auth/permissions'
import { getLeadAccessFilter } from './access'
import { emailNotificationDraftContext } from '@/lib/email-notifications'
import { followUpWritesEnabled } from './follow-up-policy'
export const followUpUnavailable = () => new AppError('NOT_FOUND', 'This follow-up is no longer available in your current access.', 404)
export const followUpChanged = () => new AppError('FOLLOW_UP_CHANGED', 'The follow-up changed. Refresh before continuing.', 409)
export function requireFollowUpWrites() { if (!followUpWritesEnabled()) throw new AppError('FOLLOW_UP_PAUSED', 'Follow-up writes and manual sending are temporarily paused. Your work is retained.', 503) }
export async function currentFollowUpAccess(db: Prisma.TransactionClient, organizationId: string, userId: string, write = false) {
  const user = await db.user.findUnique({ where: { id: userId }, include: { organizationMemberships: true, teamMemberships: { where: { team: { organizationId } }, include: { team: true, role: { include: { permissions: true } } } } } })
  if (!user || !user.organizationMemberships.some(row => row.organizationId === organizationId)) throw new AppError('FORBIDDEN', 'Current business membership is required.', 403)
  requirePermission(user, 'leads:read')
  if (write) requirePermission(user, 'leads:write')
  return { filter: await getLeadAccessFilter(user, organizationId), canWrite: hasPermission(user, 'leads:write'), taskScope: memberTaskScope(user) ? { assigneeId: userId } : {} }
}
export async function followUpLead(db: Prisma.TransactionClient, organizationId: string, userId: string, leadId: string, write = false) {
  const access = await currentFollowUpAccess(db, organizationId, userId, write)
  const lead = await db.lead.findFirst({ where: { id: leadId, organizationId, mergedIntoId: null, AND: [access.filter] } })
  if (!lead) throw followUpUnavailable()
  return { lead, access }
}
export async function lockFollowUpMember(db: Prisma.TransactionClient, organizationId: string, userId: string) {
  const rows = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM "OrganizationMember" WHERE "organizationId"=${organizationId} AND "userId"=${userId} FOR KEY SHARE`
  if (!rows.length) throw new AppError('FORBIDDEN', 'Current business membership is required.', 403)
}
export async function safeFollowUp<T>(run: () => Promise<T>) {
  try { return await run() } catch (error) {
    if (error instanceof AppError || error instanceof ZodError) throw error
    if (error && typeof error === 'object' && 'code' in error && ['P2002', 'P2034'].includes(String(error.code))) throw followUpChanged()
    throw new AppError('FOLLOW_UP_UNAVAILABLE', 'Follow-ups are unavailable. Refresh or retry the same action.', 503)
  }
}
export function followUpView<T extends { draftContext?: unknown }>(row: T, lead: { id: string; firstName: string; lastName: string; email: string | null }) {
  const parsed = emailNotificationDraftContext.safeParse(row.draftContext)
  return { ...row, draftContext: parsed.success ? parsed.data : null, lead: { id: lead.id, firstName: lead.firstName, lastName: lead.lastName, email: lead.email } }
}
