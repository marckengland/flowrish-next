import 'server-only'
import { Prisma } from '@prisma/client'
import { AppError } from '@/lib/errors'
import { receptionistConfigSchema } from '@/lib/receptionist'
import { aiProviderSettingsSchema } from '@/lib/ai-provider'
import { websiteSettingsSchema } from '@/lib/website-receptionist'
import { receptionistHomeSchema, type ReceptionistHomeSnapshot } from '@/lib/receptionist-home'
import { prisma } from '@/server/db/client'
import { callbackAccess, callbackRecipientsSql } from './callback-access'
import { currentResponseTargetsSql, responseSourcesSql } from './callback-response-sql'

export async function getReceptionistHome(org: string, user: string): Promise<ReceptionistHomeSnapshot> {
  try {
    const now = new Date()
    return await prisma.$transaction(async db => {
      const access = await callbackAccess(org, user, db)
      if (!access.admin && !access.crm) throw new AppError('FORBIDDEN', 'Current organization Settings or CRM access is required.', 403)
      const organization = await db.organization.findUniqueOrThrow({ where: { id: org }, select: { name: true } })
      let businessName = organization.name.trim().slice(0, 120) || 'Your business', readiness: ReceptionistHomeSnapshot['readiness'] = null
      if (access.admin) {
        const [business, provider, approvedDocuments, website] = await Promise.all([
          db.receptionistConfig.findUnique({ where: { organizationId: org }, select: { settings: true } }),
          db.aiProviderConfig.findUnique({ where: { organizationId: org }, select: { provider: true, model: true, enabled: true, dailyRequestLimit: true, dailyTokenLimit: true, maxOutputTokens: true, maxInputBytes: true, updatedAt: true } }),
          db.knowledgeDocument.count({ where: { organizationId: org, archivedAt: null, publishedAt: { not: null }, publishedText: { not: null }, publishedRevision: { not: null }, receptionistApprovedRevision: { equals: db.knowledgeDocument.fields.publishedRevision } } }),
          db.websiteReceptionistConfig.findUnique({ where: { organizationId: org }, select: { publicId: true, enabled: true, allowedOrigins: true, dailyMessageLimit: true, dailyTokenLimit: true, dailyCallbackLimit: true, updatedAt: true } }),
        ])
        const savedBusiness = receptionistConfigSchema.safeParse(business?.settings), savedWebsite = websiteSettingsSchema.safeParse(website ? { ...website, updatedAt: website.updatedAt.toISOString() } : null)
        let providerState: NonNullable<ReceptionistHomeSnapshot['readiness']>['provider'] = 'missing'
        if (provider) { const { updatedAt, ...metadata } = provider; providerState = !provider.enabled ? 'paused' : aiProviderSettingsSchema.safeParse({ ...metadata, expectedUpdatedAt: updatedAt.toISOString() }).success ? 'configured' : 'review' }
        if (savedBusiness.success) businessName = savedBusiness.data.businessName
        const allowedWebsites = savedWebsite.success ? savedWebsite.data.allowedOrigins.length : 0
        readiness = { businessSaved: savedBusiness.success, provider: providerState, approvedDocuments, websiteSaved: !!website, websiteValid: savedWebsite.success, websiteEnabled: website?.enabled ?? false, allowedWebsites, prerequisitesSaved: savedBusiness.success && providerState === 'configured' && approvedDocuments > 0 && savedWebsite.success && allowedWebsites > 0 }
      }
      const [counts] = await db.$queryRaw<ReceptionistHomeSnapshot['counts'][]>`WITH access AS (${callbackRecipientsSql(org, user)}), sources AS (${responseSourcesSql(org)}), targets AS (${currentResponseTargetsSql(org)}), work AS (
        SELECT h."callbackId",t."assigneeId",t."isComplete",t."dueDate" FROM "CallbackCrmHandoff" h
        JOIN "Task" t ON t.id=h."taskId" AND t."organizationId"=${org} AND t."leadId"=h."leadId" JOIN "Lead" l ON l.id=h."leadId" AND l."organizationId"=${org}
        WHERE h."organizationId"=${org} AND NOT l."isClosed" AND l."deletedAt" IS NULL AND NOT EXISTS (SELECT 1 FROM "CallbackOutcomeEvent" e WHERE e."organizationId"=${org} AND e."callbackId"=h."callbackId" AND e.action='close')
      ) SELECT
        CASE WHEN a.admin THEN (SELECT count(*)::int FROM sources WHERE phase='handoff') END AS "pendingHandoffs",
        CASE WHEN a.crm THEN (SELECT count(*)::int FROM work w WHERE a.admin OR w."assigneeId"=${user}) END AS "openCallbacks",
        CASE WHEN a.crm THEN (SELECT count(*)::int FROM work w WHERE (a.admin OR w."assigneeId"=${user}) AND NOT w."isComplete" AND w."dueDate"<${now}) END AS "overdueCallbacks",
        CASE WHEN a.admin THEN (SELECT count(*)::int FROM targets WHERE phase='handoff' AND "dueAt"<${now}) END AS "missedHandoffs",
        CASE WHEN a.crm THEN (SELECT count(*)::int FROM targets WHERE phase='attempt' AND "dueAt"<${now} AND (a.admin OR "assigneeId"=${user})) END AS "missedContacts"
        FROM access a WHERE a.admin OR a.crm`
      const policy = await db.callbackResponsePolicy.findUnique({ where: { organizationId: org }, select: { enabled: true, lastCheckedAt: true } })
      return receptionistHomeSchema.parse({ asOf: now.toISOString(), businessName, canManage: access.admin, canWork: access.crm, readiness, counts, targets: { enabled: policy?.enabled ?? false, checkedAt: policy?.lastCheckedAt?.toISOString() ?? null } })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5000, timeout: 15000 })
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError('RECEPTIONIST_HOME_UNAVAILABLE', 'Receptionist home is unavailable. Refresh and try again.', 503)
  }
}
