import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const db = {
    $queryRaw: vi.fn(),
    receptionistConfig: { findUnique: vi.fn(), upsert: vi.fn() },
    receptionistCall: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    voiceConfig: { findUnique: vi.fn() },
    organizationMember: { findUnique: vi.fn() },
    stage: { findFirst: vi.fn() },
    lead: { findMany: vi.fn(), create: vi.fn() },
    activity: { create: vi.fn() }, task: { create: vi.fn() }, auditEntry: { createMany: vi.fn() },
  }
  return { db, transaction: vi.fn(), generate: vi.fn() }
})
vi.mock('@/server/db/client', () => ({ prisma: { ...mocks.db, $transaction: mocks.transaction } }))
vi.mock('@/server/services/ai', () => ({ generateReceptionistReply: mocks.generate }))
vi.mock('@/server/services/knowledge', () => ({ getReceptionistKnowledge: async () => ({ text: '', sources: [] }) }))
vi.mock('@/server/services/voice', () => ({ getTwilioWebhookContext: vi.fn() }))

import { saveReceptionistConfig, handleReceptionistCall } from '../receptionist'
import { initialCallState } from '@/lib/receptionist'

const orgId = '11111111-1111-4111-8111-111111111111'
const config = {
  enabled: true, businessName: 'Acme', knowledge: 'Bicycle repairs', mode: 'always' as const,
  timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5], forwardTo: '',
  assigneeId: '22222222-2222-4222-8222-222222222222', stageId: '33333333-3333-4333-8333-333333333333',
}
const input = { callSid: `CA${'a'.repeat(32)}`, from: '+639181234567', turn: 1, speech: 'yes', digits: '', actionPath: `/api/voice/receptionist/${orgId}` }
const state = { ...initialCallState(input.from), fullName: 'Jane Smith', reason: 'Bicycle repair', awaitingConfirmation: true }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.transaction.mockImplementation(async (fn: (db: typeof mocks.db) => unknown) => fn(mocks.db))
  mocks.db.$queryRaw.mockResolvedValue([])
  mocks.db.receptionistConfig.findUnique.mockResolvedValue({ settings: config })
  mocks.db.organizationMember.findUnique.mockResolvedValue({ userId: config.assigneeId })
  mocks.db.stage.findFirst.mockResolvedValue({ id: config.stageId })
  mocks.db.voiceConfig.findUnique.mockResolvedValue({ twilioAccountSid: `AC${'a'.repeat(32)}`, twilioCallerId: '+639171234567', twilioAuthToken: 'encrypted' })
  mocks.db.receptionistCall.findUnique.mockResolvedValue({ id: 'call-1', turn: 1, state, status: 'active', response: '<Response/>', createdAt: new Date() })
  mocks.db.receptionistCall.updateMany.mockResolvedValue({ count: 1 })
  mocks.db.lead.findMany.mockResolvedValue([])
  mocks.db.lead.create.mockResolvedValue({ id: 'lead-1' })
  mocks.db.task.create.mockResolvedValue({ id: 'task-1' })
  mocks.db.activity.create.mockResolvedValue({ id: 'activity-1' })
})

afterEach(() => { vi.useRealTimers() })

describe('receptionist configuration', () => {
  it('allows disabling the receptionist after the callback owner or stage was removed', async () => {
    mocks.db.organizationMember.findUnique.mockResolvedValue(null)
    mocks.db.stage.findFirst.mockResolvedValue(null)
    const disabled = await saveReceptionistConfig(orgId, { ...config, enabled: false, stageId: '' })
    expect(disabled.enabled).toBe(false)
    expect(mocks.db.receptionistConfig.upsert).toHaveBeenCalled()
  })
  it('rejects callback owners outside the organization before saving', async () => {
    mocks.db.organizationMember.findUnique.mockResolvedValue(null)
    await expect(saveReceptionistConfig(orgId, config)).rejects.toThrow('callback owner')
    expect(mocks.db.receptionistConfig.upsert).not.toHaveBeenCalled()
    expect(mocks.db.organizationMember.findUnique).toHaveBeenCalledWith({ where: { userId_organizationId: { userId: config.assigneeId, organizationId: orgId } } })
  })
  it('rejects a pipeline stage from another organization', async () => {
    mocks.db.stage.findFirst.mockResolvedValue(null)
    await expect(saveReceptionistConfig(orgId, config)).rejects.toThrow('stage')
    expect(mocks.db.receptionistConfig.upsert).not.toHaveBeenCalled()
  })
  it('requires a stored Twilio Auth Token and prevents forwarding loops', async () => {
    mocks.db.voiceConfig.findUnique.mockResolvedValue({ twilioCallerId: '+639171234567' })
    await expect(saveReceptionistConfig(orgId, config)).rejects.toThrow('Twilio')
    mocks.db.voiceConfig.findUnique.mockResolvedValue({ twilioAccountSid: 'ACtest', twilioAuthToken: 'encrypted', twilioCallerId: '+639171234567' })
    await expect(saveReceptionistConfig(orgId, { ...config, forwardTo: '+639171234567' })).rejects.toThrow('different')
  })
})

describe('confirmed callback capture', () => {
  it('forwards daytime calls without an unconditional failure announcement after the team disconnects', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-02T02:00:00Z'))
    mocks.db.receptionistConfig.findUnique.mockResolvedValue({ settings: { ...config, mode: 'after_hours', forwardTo: '+639191234567' } })
    mocks.db.receptionistCall.findUnique.mockResolvedValue({ id: 'call-1', turn: 0, state: initialCallState(input.from), status: 'active', response: '', createdAt: new Date() })
    const xml = await handleReceptionistCall(orgId, { ...input, turn: 0 })
    expect(xml).toContain('<Number>+639191234567</Number>')
    expect(xml).not.toContain('could not answer')
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it('atomically saves a lead, call activity and callback assigned within the organization', async () => {
    const xml = await handleReceptionistCall(orgId, input)
    expect(xml).toContain('saved')
    expect(mocks.db.lead.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: orgId, firstName: 'Jane', lastName: 'Smith', phone: input.from, assignedUserId: config.assigneeId }) }))
    expect(mocks.db.task.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: orgId, leadId: 'lead-1', assigneeId: config.assigneeId }) }))
    expect(mocks.db.activity.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: orgId, leadId: 'lead-1', type: 'CALL' }) }))
    expect(mocks.db.receptionistCall.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'completed', leadId: 'lead-1', taskId: 'task-1' }) }))
  })

  it('reuses one exact phone match only within the organization', async () => {
    mocks.db.lead.findMany.mockResolvedValue([{ id: 'existing-lead' }])
    await handleReceptionistCall(orgId, input)
    expect(mocks.db.lead.findMany).toHaveBeenCalledWith({ where: { organizationId: orgId, phone: input.from, deletedAt: null }, take: 2 })
    expect(mocks.db.lead.create).not.toHaveBeenCalled()
    expect(mocks.db.task.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ leadId: 'existing-lead' }) }))
  })

  it('returns the saved response for duplicate deliveries without creating another callback', async () => {
    mocks.db.receptionistCall.findUnique.mockResolvedValue({ id: 'call-1', turn: 2, state, status: 'completed', response: '<Response>Already saved</Response>', createdAt: new Date() })
    expect(await handleReceptionistCall(orgId, input)).toBe('<Response>Already saved</Response>')
    expect(mocks.db.task.create).not.toHaveBeenCalled()
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('does not write CRM records when another delivery has claimed this turn', async () => {
    mocks.db.receptionistCall.updateMany.mockResolvedValue({ count: 0 })
    await handleReceptionistCall(orgId, input)
    expect(mocks.db.task.create).not.toHaveBeenCalled()
    expect(mocks.db.lead.create).not.toHaveBeenCalled()
  })

  it('rechecks the callback owner before any CRM mutation', async () => {
    mocks.db.organizationMember.findUnique.mockResolvedValue(null)
    await expect(handleReceptionistCall(orgId, input)).rejects.toThrow('callback owner')
    expect(mocks.db.lead.create).not.toHaveBeenCalled()
  })

  it('does not invoke AI or create CRM records when disabled', async () => {
    mocks.db.receptionistConfig.findUnique.mockResolvedValue({ settings: { ...config, enabled: false } })
    const xml = await handleReceptionistCall(orgId, input)
    expect(xml).toContain('<Hangup/>')
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(mocks.db.lead.create).not.toHaveBeenCalled()
  })
})
