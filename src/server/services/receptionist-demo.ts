import 'server-only'
import { prisma } from '@/server/db/client'
import { AppError } from '@/lib/errors'
import { receptionistConfigSchema } from '@/lib/receptionist'
import { demoHours, type DemoBusiness } from '@/lib/receptionist-demo'
import { callbackAccess } from './callback-access'

export async function getReceptionistDemoBusiness(organizationId: string, userId: string): Promise<DemoBusiness> {
  const access = await callbackAccess(organizationId, userId)
  if (!access.admin && !access.crm) throw new AppError('FORBIDDEN', 'Settings or CRM permissions in the current organization are required.', 403)
  return prisma.$transaction(async db => {
    const approved = (category: string) => db.knowledgeDocument.findFirst({ where: { organizationId, archivedAt: null, publishedCategory: category, publishedAt: { not: null }, publishedText: { not: null }, publishedRevision: { not: null }, receptionistApprovedRevision: { equals: db.knowledgeDocument.fields.publishedRevision } }, select: { publishedText: true }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }] })
    const [organization, profile, services, pricing] = await Promise.all([
      db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } }),
      db.receptionistConfig.findUnique({ where: { organizationId }, select: { settings: true } }),
      approved('SERVICES'), approved('PRICING'),
    ])
    const config = receptionistConfigSchema.safeParse(profile?.settings)
    const excerpt = (text: string | null | undefined) => text?.trim().slice(0, 1200) || null
    return { name: (config.success ? config.data.businessName : organization.name).trim().slice(0, 120) || 'Your business', hours: config.success ? demoHours(config.data) : null, services: excerpt(services?.publishedText), pricing: excerpt(pricing?.publishedText) }
  }, { isolationLevel: 'RepeatableRead' })
}
