import 'server-only'
import { prisma } from '@/server/db/client'
import { AppError } from '@/lib/errors'
import { generateApprovedReceptionistReply } from './receptionist-generation'
import {
  advanceCall, callStateSchema, escapeVoiceXml, gatherTwiml, initialCallState,
  isBusinessOpen, nextBusinessOpening, receptionistConfigSchema, receptionistGreeting, type ReceptionistConfig,
} from '@/lib/receptionist'

async function validateReferences(orgId: string, config: ReceptionistConfig, db = prisma) {
  const member = await db.organizationMember.findUnique({ where: { userId_organizationId: { userId: config.assigneeId, organizationId: orgId } } })
  if (!member) throw new AppError('VALIDATION_ERROR', 'The callback owner must belong to this organization.', 400)
  const stage = await db.stage.findFirst({ where: { id: config.stageId, pipeline: { organizationId: orgId }, isClosedWon: false, isClosedLost: false } })
  if (!stage) throw new AppError('VALIDATION_ERROR', 'Choose an open pipeline stage in this organization.', 400)
}

export async function saveReceptionistConfig(orgId: string, input: unknown, options: { createOnly?: boolean } = {}) {
  const config = receptionistConfigSchema.parse(input)
  if (config.enabled) {
    await validateReferences(orgId, config)
    const voice = await prisma.voiceConfig.findUnique({ where: { organizationId: orgId } })
    if (!voice?.twilioAuthToken || !voice.twilioAccountSid || !voice.twilioCallerId) throw new AppError('VALIDATION_ERROR', 'Connect Twilio with an Auth Token and incoming phone number before enabling the receptionist.', 400)
    if (config.forwardTo === voice.twilioCallerId) throw new AppError('VALIDATION_ERROR', 'The forwarding number must be different from the incoming Twilio number.', 400)
  }
  if (options.createOnly) {
    try { await prisma.receptionistConfig.create({ data: { organizationId: orgId, settings: config } }) }
    catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') throw new AppError('CONFIG_EXISTS', 'Receptionist settings already exist. Reload before continuing.', 412)
      throw error
    }
  } else {
    await prisma.receptionistConfig.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId, settings: config }, update: { settings: config } })
  }
  return config
}

export interface ReceptionistCallInput {
  callSid: string
  from: string
  turn: number
  speech: string
  digits: string
  actionPath: string
}

export async function handleReceptionistCall(orgId: string, input: ReceptionistCallInput): Promise<string> {
  const stored = await prisma.receptionistConfig.findUnique({ where: { organizationId: orgId } })
  const parsed = receptionistConfigSchema.safeParse(stored?.settings)
  const end = (message: string) => gatherTwiml(message, '', true)
  if (!parsed.success || !parsed.data.enabled) return end('This number is not accepting receptionist messages right now. Please call again later.')
  const config = parsed.data
  const key = { organizationId_callSid: { organizationId: orgId, callSid: input.callSid } }
  let call = await prisma.receptionistCall.findUnique({ where: key })
  if (call && (call.turn !== input.turn || call.status !== 'active')) return call.response
  if (!call && input.turn !== 0) return end('This call session could not be found. Please call again.')
  if (!call) {
    call = await prisma.receptionistCall.upsert({ where: key, create: { organizationId: orgId, callSid: input.callSid, state: initialCallState(input.from) }, update: {} })
    if (call.turn !== input.turn || call.status !== 'active') return call.response
  }
  const state = callStateSchema.parse(call.state)
  const action = `${input.actionPath}?turn=${input.turn + 1}`
  const expired = Date.now() - call.createdAt.getTime() > 60 * 60 * 1000
  const forward = input.turn === 0 && config.mode === 'after_hours' && isBusinessOpen(config, new Date())
  const result = expired
    ? { state, reply: 'This call session has expired. Please call again.', finish: true, capture: false }
    : input.turn === 0
      ? { state, reply: receptionistGreeting(config.businessName), finish: false, capture: false }
      : await advanceCall(state, input, config, async (currentState, currentConfig) => {
        return (await generateApprovedReceptionistReply(orgId, input.speech ?? '', currentState, currentConfig)).extraction
      })
  const response = forward
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Dial timeout="25"><Number>${escapeVoiceXml(config.forwardTo)}</Number></Dial><Say>Thank you for calling. Goodbye.</Say><Hangup/></Response>`
    : gatherTwiml(result.reply, action, result.finish)

  return prisma.$transaction(async (tx) => {
    // The row update locks this turn. Concurrent retries wait, then fail the
    // turn predicate after the winner commits. All CRM writes share this transaction.
    const claimed = await tx.receptionistCall.updateMany({ where: { id: call.id, organizationId: orgId, turn: input.turn, status: 'active' }, data: { turn: { increment: 1 } } })
    if (!claimed.count) return (await tx.receptionistCall.findUnique({ where: key }))?.response ?? end('Please call again.')
    let leadId: string | undefined
    let taskId: string | undefined
    if (result.capture) {
      const member = await tx.organizationMember.findUnique({ where: { userId_organizationId: { userId: config.assigneeId, organizationId: orgId } } })
      if (!member) throw new AppError('VALIDATION_ERROR', 'The callback owner is no longer in this organization.', 400)
      const stage = await tx.stage.findFirst({ where: { id: config.stageId, pipeline: { organizationId: orgId }, isClosedWon: false, isClosedLost: false } })
      if (!stage) throw new AppError('VALIDATION_ERROR', 'The callback pipeline stage is no longer available.', 400)
      const matches = await tx.lead.findMany({ where: { organizationId: orgId, phone: result.state.phone, deletedAt: null }, take: 2 })
      const [firstName, ...rest] = result.state.fullName.split(/\s+/)
      const lead = matches.length === 1 ? matches[0] : await tx.lead.create({ data: { organizationId: orgId, firstName, lastName: rest.join(' '), phone: result.state.phone, description: result.state.reason, stageId: config.stageId, assignedUserId: config.assigneeId, leadStatus: 'Open' } })
      leadId = lead.id
      const transcript = result.state.messages.map((message) => `${message.role === 'user' ? 'Caller' : 'Receptionist'}: ${message.content}`).join('\n')
      const activity = await tx.activity.create({ data: { organizationId: orgId, type: 'CALL', leadId: lead.id, createdById: config.assigneeId, callDate: call.createdAt, notes: `AI receptionist callback request\n${result.state.reason}\n\n${transcript}` } })
      const task = await tx.task.create({ data: { organizationId: orgId, title: `Call back ${result.state.fullName}`, description: `${result.state.reason}\nCallback: ${result.state.phone}`, priority: 'MEDIUM', dueDate: nextBusinessOpening(config, new Date()), leadId: lead.id, assigneeId: config.assigneeId } })
      taskId = task.id
      await tx.auditEntry.createMany({ data: [
        ...(matches.length === 1 ? [] : [{ organizationId: orgId, userId: config.assigneeId, action: 'CREATE' as const, entityType: 'Lead', entityId: lead.id }]),
        { organizationId: orgId, userId: config.assigneeId, action: 'CREATE', entityType: 'Task', entityId: task.id },
        { organizationId: orgId, userId: config.assigneeId, action: 'CREATE', entityType: 'Activity', entityId: activity.id },
      ] })
    }
    await tx.receptionistCall.update({ where: { id: call.id, organizationId: orgId }, data: { state: result.state, response, status: forward ? 'forwarded' : result.capture ? 'completed' : result.finish ? 'incomplete' : 'active', leadId, taskId } })
    return response
  })
}
