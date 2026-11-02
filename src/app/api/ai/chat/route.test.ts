import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ stream: vi.fn(), append: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: async () => ({ dbUser: { id: 'user' }, organizationId: 'org' }) }))
vi.mock('@/server/auth/entitlements', () => ({ requireEntitlement: async () => {} }))
vi.mock('@/server/services/ai', () => ({ chatMessageStream: mocks.stream, KNOWLEDGE_HISTORY_MARKER: '\n\nKnowledge sources:\n' }))
vi.mock('@/server/services/conversations', () => ({ createConversation: async () => ({ id: '11111111-1111-4111-8111-111111111111' }), getConversationHistory: async () => [], appendMessage: mocks.append }))
import { POST } from './route'
const request = () => new NextRequest('http://localhost/api/ai/chat', { method: 'POST', body: JSON.stringify({ message: 'Repair prices?' }), headers: { 'content-type': 'application/json' } })
beforeEach(() => vi.clearAllMocks())
describe('knowledge chat streaming provenance', () => {
  it('marks interrupted knowledge answers before persistence so they cannot become action history', async () => {
    mocks.stream.mockImplementation(async function* () { yield { type: 'delta', text: 'Repairs cost 500 pesos.', knowledgeAnswer: true }; throw new Error('private backend failure') })
    const response = await POST(request())
    const body = await response.text()
    expect(body).toContain('"type":"error"')
    expect(body).not.toContain('private backend failure')
    expect(mocks.append).toHaveBeenLastCalledWith(expect.any(String), 'assistant', expect.stringContaining('\n\nKnowledge sources:\n'), 'user', 'org')
  })
  it('includes safe source metadata in the final frame and persists the citation footer', async () => {
    const knowledgeSources = [{ id: 'source-id', title: 'Repair prices', revision: 2, category: 'PRICING' }]
    mocks.stream.mockImplementation(async function* () { yield { type: 'delta', text: 'Repair costs 500.', knowledgeAnswer: true }; return { message: 'Repair costs 500.\n\nKnowledge sources:\n[K1] Repair prices (revision 2)', knowledgeSources } })
    const response = await POST(request())
    const frames = (await response.text()).split('\n\n').filter(Boolean).map(frame => JSON.parse(frame.slice(6)))
    expect(frames.at(-1)).toMatchObject({ type: 'done', action: null, knowledgeSources })
    expect(mocks.append).toHaveBeenLastCalledWith(expect.any(String), 'assistant', expect.stringContaining('[K1] Repair prices (revision 2)'), 'user', 'org')
  })
  it('preserves ordinary partial replies without adding knowledge provenance', async () => {
    mocks.stream.mockImplementation(async function* () { yield { type: 'delta', text: 'Ordinary CRM answer.' }; throw new Error('interrupted') })
    const response = await POST(request())
    await response.text()
    expect(mocks.append).toHaveBeenLastCalledWith(expect.any(String), 'assistant', 'Ordinary CRM answer.', 'user', 'org')
  })
})
