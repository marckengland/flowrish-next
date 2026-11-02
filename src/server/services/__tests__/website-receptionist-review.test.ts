import { expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ document: { id: '0ec2f499-efbd-497d-8ffa-d3fe84d21c80', revision: 1, title: 'Fees', category: 'PRICING', contentText: '' }, chunks: [] as any[], ai: vi.fn().mockResolvedValue('Fictional response') }))
vi.mock('@/server/auth/permissions', () => ({ getEffectivePermissions: async () => new Set(['admin:settings']) }))
vi.mock('@/server/services/ai', () => ({ generateWebsiteReceptionistText: mocks.ai }))
vi.mock('@/server/db/client', () => {
  const tx = { knowledgeDocument: { findFirst: async () => mocks.document, updateMany: async () => ({ count: 1 }), findFirstOrThrow: async () => mocks.document }, knowledgeChunk: { deleteMany: async () => ({}), createMany: async ({ data }: any) => { mocks.chunks = data } }, auditEntry: { create: async () => ({}) } }
  return { prisma: { organizationMember: { findUnique: async () => ({ id: 'member' }) }, $transaction: async (run: any) => run(tx), $queryRaw: async () => mocks.chunks.filter(chunk => /bicycle/i.test(chunk.content)).map(chunk => ({ ...chunk, id: mocks.document.id, publishedText: mocks.document.contentText })) } }
})
import { transitionKnowledge } from '../knowledge'
import { generateWebsiteReceptionistAnswer } from '../website-receptionist-generation'
it('preserves a qualifier from an approved paragraph that spans retrieval chunks', async () => {
  mocks.document.contentText = 'Bicycle repair price is 500 pesos. ' + 'Additional explanation is provided here. '.repeat(35) + 'That price applies only when a paid inspection has already been completed.'
  await transitionKnowledge('org', 'user', mocks.document.id, { action: 'publish', revision: 1 })
  expect(mocks.chunks.length).toBeGreaterThan(1)
  await generateWebsiteReceptionistAnswer('org', 'Fictional Repairs', 'Bicycle repair price?', [])
  const publicFacts = mocks.ai.mock.calls[0][4]
  expect(publicFacts).toContain('price is 500 pesos')
  expect(publicFacts).toContain('only when a paid inspection')
})
it('skips a whole oversized paragraph rather than exposing an incomplete factual claim', async () => {
  mocks.ai.mockClear()
  mocks.document.contentText = 'Bicycleprice repair cost is 500 pesos. ' + 'Long fictional explanation. '.repeat(100) + 'Only after paid inspection.'
  await transitionKnowledge('org', 'user', mocks.document.id, { action: 'publish', revision: 1 })
  expect(await generateWebsiteReceptionistAnswer('org', 'Fictional Repairs', 'Bicycleprice repair price?', [])).toContain('callback')
  expect(mocks.ai).not.toHaveBeenCalled()
})
