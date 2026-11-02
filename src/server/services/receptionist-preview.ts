import 'server-only'
import { z } from 'zod'
import { AppError } from '@/lib/errors'
import { advanceCall, callStateSchema, initialCallState, phoneSchema, receptionistConfigSchema, receptionistGreeting } from '@/lib/receptionist'
import { prisma } from '@/server/db/client'
import { getEffectivePermissions } from '@/server/auth/permissions'
import { generateApprovedReceptionistReply } from './receptionist-generation'

const previewStateSchema = callStateSchema.extend({
  silence: z.number().int().min(0).max(2),
}).strict().superRefine((state, ctx) => {
  if (state.messages.reduce((length, message) => length + message.content.length, 0) > 16000) {
    ctx.addIssue({ code: 'custom', message: 'This preview is too long. Start a new preview.' })
  }
  if (state.awaitingConfirmation && (!state.fullName.trim() || !phoneSchema.safeParse(state.phone).success || !state.reason.trim())) {
    ctx.addIssue({ code: 'custom', message: 'A complete callback is required before confirmation.' })
  }
})

const previewInputSchema = z.object({
  state: previewStateSchema.optional(),
  settingsVersion: z.string().min(1).max(100).optional(),
  speech: z.string().max(2000).optional(),
  digits: z.string().regex(/^[0-9*#]{0,20}$/).optional(),
}).strict().superRefine((input, ctx) => {
  if (input.state ? !input.settingsVersion : input.speech !== undefined || input.digits !== undefined || input.settingsVersion !== undefined) {
    ctx.addIssue({ code: 'custom', message: 'Start a new preview before sending a turn.' })
  }
})

async function requireCurrentMembership(organizationId: string, userId: string) {
  const member = await prisma.organizationMember.findUnique({ where: { userId_organizationId: { userId, organizationId } }, select: { id: true } })
  if (!member) throw new AppError('FORBIDDEN', 'Current organization membership is required.', 403)
  const permissions = await getEffectivePermissions(userId, organizationId)
  if (!permissions.has('admin:settings')) throw new AppError('FORBIDDEN', 'Administrator access is required for this organization.', 403)
}

export async function getReceptionistReadiness(organizationId: string, userId: string) {
  await requireCurrentMembership(organizationId, userId)
  const [stored, approvedDocuments, voice] = await Promise.all([
    prisma.receptionistConfig.findUnique({ where: { organizationId } }),
    prisma.knowledgeDocument.count({ where: { organizationId, archivedAt: null, publishedAt: { not: null }, receptionistApprovedRevision: { equals: prisma.knowledgeDocument.fields.publishedRevision } } }),
    prisma.voiceConfig.findUnique({ where: { organizationId }, select: { twilioAccountSid: true, twilioCallerId: true, twilioAuthToken: true } }),
  ])
  const config = receptionistConfigSchema.safeParse(stored?.settings)
  return {
    saved: config.success,
    settingsVersion: config.success && stored ? stored.updatedAt.toISOString() : null,
    approvedDocuments,
    hasManualKnowledge: config.success && Boolean(config.data.knowledge.trim()),
    voiceConfigured: Boolean(voice?.twilioAccountSid && voice.twilioCallerId),
    hasAuthToken: Boolean(voice?.twilioAuthToken),
  }
}

type PreviewGeneration = { mode: 'ai' | 'fallback'; reason?: ReturnType<typeof previewFailureReason> }

function previewFailureReason(error: unknown) {
  if (error instanceof AppError && error.code === 'AI_UNAVAILABLE') {
    return 'providerStatus' in error && error.providerStatus === 429 ? 'rate_limited' as const : 'provider_unavailable' as const
  }
  if (error instanceof SyntaxError) return 'invalid_json' as const
  if (error instanceof z.ZodError) return 'invalid_response' as const
  if (error && typeof error === 'object' && 'name' in error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return 'timeout' as const
  return 'service_unavailable' as const
}

export async function previewReceptionist(organizationId: string, userId: string, rawInput: unknown) {
  await requireCurrentMembership(organizationId, userId)
  const input = previewInputSchema.parse(rawInput)
  const stored = await prisma.receptionistConfig.findUnique({ where: { organizationId } })
  const config = receptionistConfigSchema.safeParse(stored?.settings)
  if (!stored || !config.success) throw new AppError('PREVIEW_NOT_CONFIGURED', 'Save your receptionist settings before starting a preview.', 409)
  const settingsVersion = stored.updatedAt.toISOString()
  if (input.state && input.settingsVersion !== settingsVersion) throw new AppError('PREVIEW_STALE', 'Saved settings changed. Start a new preview.', 409)
  if (!input.state) return { state: initialCallState(''), settingsVersion, reply: receptionistGreeting(config.data.businessName), finished: false, callback: null, sources: [], generation: undefined as PreviewGeneration | undefined }

  let sources: Array<{ id: string; title: string; revision: number }> = []
  let generation: PreviewGeneration | undefined
  const result = await advanceCall(input.state, { speech: input.speech ?? '', digits: input.digits ?? '' }, config.data, async (state, currentConfig) => {
    try {
      const generated = await generateApprovedReceptionistReply(organizationId, input.speech ?? '', state, currentConfig)
      sources = generated.sources
      generation = { mode: 'ai' }
      return generated.extraction
    } catch (error) {
      generation = { mode: 'fallback', reason: previewFailureReason(error) }
      throw error
    }
  })
  const reply = result.capture
    ? 'Preview complete. This callback summary is for testing only; nothing was saved. Goodbye.'
    : result.state.awaitingConfirmation
      ? result.reply.replace('to save your callback request', 'to confirm this preview callback summary')
      : result.reply
  result.state.messages[result.state.messages.length - 1] = { role: 'assistant', content: reply }
  return {
    state: result.state, settingsVersion, reply, finished: result.finish,
    callback: result.capture ? { fullName: result.state.fullName, phone: result.state.phone, reason: result.state.reason } : null,
    sources, generation,
  }
}
