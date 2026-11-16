import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ knowledge: vi.fn(), fetch: vi.fn() }))
vi.mock('../org-ai-provider', () => ({ resolveOrganizationAi: async () => null }))
vi.mock('../knowledge', () => ({ getAirishKnowledge: mocks.knowledge }))
vi.mock('@/server/db/middleware', () => ({ createTenantPrisma: () => ({ aiPromptConfig: { findFirst: async () => null } }) }))
vi.mock('@/lib/env', () => ({ env: { AI_API_KEY: 'synthetic-key', AI_API_URL: 'https://ai.example.invalid/v1', AI_MODEL: 'synthetic' } }))
import { chatMessage, chatMessageStream } from '../ai'

const answer = 'Qualified leads are the largest group.\n\n| Stage | Deals |\n| --- | ---: |\n| Qualified | 12 |\n| Won | 4 |'
const response = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }))
const stream = () => new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: answer } }] }) + '\n\ndata: [DONE]\n\n')
beforeEach(() => { vi.clearAllMocks(); mocks.knowledge.mockResolvedValue({ text: '', sources: [] }); vi.stubGlobal('fetch', mocks.fetch) })

it.each(['regular', 'stream', 'knowledge'] as const)('keeps plain-language, factual and visual rules in the %s chat path', async mode => {
  if (mode === 'knowledge') mocks.knowledge.mockResolvedValue({ text: '[K1] Qualified 12, Won 4', sources: [{ id: 'doc', title: 'Provided figures', revision: 1, category: 'FAQ' }] })
  if (mode === 'regular') { mocks.fetch.mockResolvedValueOnce(response(answer)); expect((await chatMessage('Compare the provided stages', 'actor', 'org')).message).toBe(answer) }
  else {
    if (mode === 'knowledge') mocks.fetch.mockResolvedValueOnce(response('No action requested.'))
    mocks.fetch.mockResolvedValueOnce(stream())
    const generator = chatMessageStream('Compare the provided stages', 'actor', 'org'); let text = ''
    for (;;) { const next = await generator.next(); if (next.done) { expect(next.value.message).toContain(answer); expect(next.value.action).toBeUndefined(); break } text += next.value.text }
    expect(text).toBe(answer)
  }
  const requests = mocks.fetch.mock.calls.map(([, init]) => JSON.parse(init.body))
  for (const request of requests) {
    const system = request.messages[0].content
    expect(system).toContain('Lead with the answer')
    expect(system).toContain('plain, familiar words')
    expect(system).toContain('Never invent figures')
    expect(system).toContain('no live pipeline or record lookup')
    expect(system).toContain('Markdown table')
    expect(system).toContain('```chart')
    expect(system).toContain('at most 12')
    expect(request.tools).toBeUndefined()
  }
})
