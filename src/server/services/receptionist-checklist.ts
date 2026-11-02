import 'server-only'
import { AppError } from '@/lib/errors'
import { env } from '@/lib/env'
import { aiProviderSettingsSchema } from '@/lib/ai-provider'
import { receptionistConfigSchema } from '@/lib/receptionist'
import type { ReceptionistChecklist, ReceptionistSetupCheck } from '@/lib/receptionist-checklist'
import { prisma } from '@/server/db/client'
import { getEffectivePermissions } from '@/server/auth/permissions'

export async function getReceptionistChecklist(organizationId: string, userId: string): Promise<ReceptionistChecklist> {
  try {
    const member = await prisma.organizationMember.findUnique({ where: { userId_organizationId: { userId, organizationId } }, select: { id: true } })
    if (!member || !(await getEffectivePermissions(userId, organizationId)).has('admin:settings')) throw new AppError('FORBIDDEN', 'Administrator access to this organization is required.', 403)
    const [stored, documents, organizationAi] = await Promise.all([
      prisma.receptionistConfig.findUnique({ where: { organizationId }, select: { settings: true, updatedAt: true } }),
      prisma.knowledgeDocument.count({ where: { organizationId, archivedAt: null, publishedAt: { not: null }, receptionistApprovedRevision: { equals: prisma.knowledgeDocument.fields.publishedRevision } } }),
      // Metadata only: never select ciphertext, decrypt credentials, or test a provider here.
      prisma.aiProviderConfig.findUnique({ where: { organizationId }, select: { provider: true, model: true, enabled: true, dailyRequestLimit: true, dailyTokenLimit: true, maxOutputTokens: true, maxInputBytes: true, updatedAt: true } }),
    ])
    const parsed = receptionistConfigSchema.safeParse(stored?.settings)
    let callbacks = false
    if (parsed.success && parsed.data.assigneeId && parsed.data.stageId) {
      const [owner, stage] = await Promise.all([
        prisma.organizationMember.findUnique({ where: { userId_organizationId: { userId: parsed.data.assigneeId, organizationId } }, select: { id: true } }),
        prisma.stage.findFirst({ where: { id: parsed.data.stageId, pipeline: { organizationId }, isClosedWon: false, isClosedLost: false }, select: { id: true } }),
      ])
      callbacks = Boolean(owner && stage)
    }
    let aiComplete = !organizationAi && Boolean(env.AI_API_KEY?.trim())
    let aiDetail = aiComplete ? 'Deployment AI is configured; its connection and quota are not verified.' : 'Configure an AI provider in Settings → AI provider. No connection has been tested.'
    if (organizationAi) {
      const { updatedAt, ...metadata } = organizationAi
      const valid = aiProviderSettingsSchema.safeParse({ ...metadata, expectedUpdatedAt: updatedAt.toISOString() }).success
      if (!organizationAi.enabled) aiDetail = 'Organization AI is paused. Deployment credentials will not be used.'
      else if (!valid) aiDetail = 'Review the saved organization AI model and limits. Deployment credentials will not be used.'
      else {
        const day = new Date(new Date().toISOString().slice(0, 10))
        const usage = await prisma.aiUsageDay.findUnique({ where: { organizationId_day: { organizationId, day } }, select: { requests: true, reservedTokens: true } })
        const requests = Math.max(0, organizationAi.dailyRequestLimit - (usage?.requests ?? 0))
        const tokens = Math.max(0, organizationAi.dailyTokenLimit - (usage?.reservedTokens ?? 0))
        // Match the conservative reservation used by AI transport, without building a prompt or reading a key.
        const reservation = organizationAi.maxInputBytes + 256 + organizationAi.maxOutputTokens
        aiComplete = requests > 0 && tokens >= reservation
        aiDetail = aiComplete
          ? `Organization AI is configured with ${requests} requests and ${tokens} reserved-token allowance remaining today (UTC). Credentials and replies are not verified.`
          : 'The daily organization AI allowance cannot cover a full configured input/output reservation. Shorter requests may fit; review AI provider limits. Deployment credentials will not be used.'
      }
    }
    const knowledge = Boolean(documents || (parsed.success && parsed.data.knowledge.trim()))
    const checks: ReceptionistSetupCheck[] = [
      { id: 'business', label: 'Business name', status: parsed.success ? 'complete' : 'attention', detail: parsed.success ? 'A business greeting name is saved.' : 'Save valid business details before checking the greeting.' },
      { id: 'hours', label: 'Business hours', status: parsed.success ? 'complete' : 'attention', detail: parsed.success ? 'A valid time zone, working days, and opening/closing times are saved.' : 'Save a valid time zone, working days, and opening/closing times.' },
      { id: 'knowledge', label: 'Approved business knowledge', status: knowledge ? 'complete' : 'attention', detail: knowledge ? `${documents} approved public documents; ${parsed.success && parsed.data.knowledge.trim() ? 'saved FAQs available' : 'no saved FAQs'}. Review prices, services, and answers for accuracy.` : 'Add approved pricing, services, and FAQs. Private drafts and unapproved documents do not count.' },
      { id: 'callbacks', label: 'Callback owner and stage', status: callbacks ? 'complete' : 'attention', detail: callbacks ? 'The callback owner is a current organization member and the pipeline stage is open. Live callback routing is not verified.' : 'Choose a current organization member and an open pipeline stage. Browser summaries can still be tested without live callback routing.' },
      { id: 'ai', label: 'AI configuration and allowance', status: aiComplete ? 'complete' : 'attention', detail: aiDetail },
    ]
    return { scope: 'saved_setup', checkedAt: new Date().toISOString(), settingsVersion: parsed.success && stored ? stored.updatedAt.toISOString() : null, checks }
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError('READINESS_UNAVAILABLE', 'Saved receptionist setup could not be checked. Try again later.', 503)
  }
}
