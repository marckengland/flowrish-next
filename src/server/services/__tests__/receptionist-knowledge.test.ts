import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initialCallState } from '@/lib/receptionist'
const mocks = vi.hoisted(() => {
  const db = { receptionistConfig: { findUnique: vi.fn() }, receptionistCall: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() } }
  return { db, transaction: vi.fn(), generate: vi.fn(), publicKnowledge: vi.fn(), privateKnowledge: vi.fn() }
})
vi.mock('@/server/db/client', () => ({ prisma: { ...mocks.db, $transaction: mocks.transaction } }))
vi.mock('@/server/services/ai', () => ({ generateReceptionistReply: mocks.generate }))
vi.mock('@/server/services/knowledge', () => ({ getReceptionistKnowledge: mocks.publicKnowledge, getAirishKnowledge: mocks.privateKnowledge }))
import { handleReceptionistCall } from '../receptionist'
const orgId = '11111111-1111-4111-8111-111111111111'
const config = { enabled: true, businessName: 'Bikes', knowledge: 'Manual approved FAQ', mode: 'always', timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5], forwardTo: '', assigneeId: '22222222-2222-4222-8222-222222222222', stageId: '33333333-3333-4333-8333-333333333333' }
const input = { callSid: 'CA' + 'a'.repeat(32), from: '+639181234567', turn: 1, speech: 'What does a repair cost?', digits: '', actionPath: '/voice' }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.db.receptionistConfig.findUnique.mockResolvedValue({ settings: config })
  mocks.db.receptionistCall.findUnique.mockResolvedValue({ id: 'call', turn: 1, state: initialCallState(input.from), status: 'active', createdAt: new Date() })
  mocks.db.receptionistCall.updateMany.mockResolvedValue({ count: 1 })
  mocks.transaction.mockImplementation((fn: (db: typeof mocks.db) => unknown) => fn(mocks.db))
  mocks.generate.mockResolvedValue({ fullName: null, phone: null, reason: null, reply: 'How can we help?' })
  mocks.publicKnowledge.mockResolvedValue({ text: '[K1] Approved repairs cost 500 pesos.', sources: [{ id: 'public-doc', title: 'Repair prices', revision: 1, category: 'PRICING', excerpt: 'Repairs cost 500 pesos.' }] })
})
describe('public receptionist knowledge boundary', () => {
  it('retrieves only approved knowledge for the signed organization and preserves manual FAQs', async () => {
    await handleReceptionistCall(orgId, input)
    expect(mocks.publicKnowledge).toHaveBeenCalledWith(orgId, input.speech)
    expect(mocks.privateKnowledge).not.toHaveBeenCalled()
    const supplied = mocks.generate.mock.calls[0][1]
    expect(supplied.knowledge).toContain('Manual approved FAQ')
    expect(supplied.knowledge).toContain('Approved repairs cost 500 pesos.')
    expect(supplied.knowledge).not.toContain('public-doc')
  })
  it('looks up current approval on every AI turn so revoked text does not persist', async () => {
    await handleReceptionistCall(orgId, input)
    mocks.publicKnowledge.mockResolvedValue({ text: '', sources: [] })
    await handleReceptionistCall(orgId, input)
    expect(mocks.publicKnowledge).toHaveBeenCalledTimes(2)
    expect(mocks.generate.mock.calls[1][1].knowledge).toBe('Manual approved FAQ')
  })
  it('falls back to callback capture when the approved library cannot be read', async () => {
    mocks.publicKnowledge.mockRejectedValue(new Error('Private database error'))
    const response = await handleReceptionistCall(orgId, input)
    expect(response).toContain('callback message')
    expect(response).not.toContain('Private database')
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(mocks.privateKnowledge).not.toHaveBeenCalled()
  })
})

it('does not replay old assistant business facts after public approval is revoked', async () => {
  mocks.db.receptionistCall.findUnique.mockResolvedValue({ id: 'call', turn: 1, state: { ...initialCallState(input.from), messages: [{ role: 'user', content: 'What do repairs cost?' }, { role: 'assistant', content: 'Previously published price was 500 pesos.' }] }, status: 'active', createdAt: new Date() })
  mocks.publicKnowledge.mockResolvedValue({ text: '', sources: [] })
  await handleReceptionistCall(orgId, input)
  const supplied = mocks.generate.mock.calls[0][0]
  expect(supplied.messages.map((entry: { content: string }) => entry.content).join(' ')).not.toContain('Previously published price')
  expect(supplied.messages.some((entry: { role: string }) => entry.role === 'user')).toBe(true)
})
