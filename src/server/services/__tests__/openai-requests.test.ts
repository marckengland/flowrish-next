import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), finish: vi.fn() }))
vi.mock('../org-ai-provider', () => ({ resolveOrganizationAi: async () => ({ organizationId: 'org', version: new Date(), provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'synthetic-openai-model', apiKey: 'synthetic-only', maxOutputTokens: 700, maxInputBytes: 16000 }), reserveAiUsage: async () => ({ organizationId: 'org', day: new Date('2026-11-22'), reservedTokens: 1000 }), finishAiUsage: mocks.finish }))
vi.mock('../knowledge', () => ({ getAirishKnowledge: async () => ({ text: '', sources: [] }) }))
vi.mock('@/server/db/middleware', () => ({ createTenantPrisma: () => ({ aiPromptConfig: { findFirst: async () => null } }) }))
vi.mock('@/lib/env', () => ({ env: {} }))
import { chatMessage, chatMessageStream } from '../ai'
beforeEach(() => { vi.clearAllMocks(); mocks.finish.mockResolvedValue(undefined); vi.stubGlobal('fetch', mocks.fetch) })

it.each([false, true])('uses the supported OpenAI token limit without incompatible sampling fields, stream=%s', async streaming => {
  const content = 'Please share the pipeline figures to compare.'
  mocks.fetch.mockResolvedValueOnce(new Response(streaming ? 'data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [], usage: { total_tokens: 99 } }) + '\n\ndata: [DONE]\n\n' : JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 99 } })))
  if (streaming) { const generator = chatMessageStream('Compare pipeline figures', 'actor', 'org'); for (;;) { const next = await generator.next(); if (next.done) { expect(next.value.message).toBe(content); break } } }
  else expect((await chatMessage('Compare pipeline figures', 'actor', 'org')).message).toBe(content)
  expect(mocks.fetch).toHaveBeenCalledOnce()
  const [url, init] = mocks.fetch.mock.calls[0]
  expect(url).toBe('https://api.openai.com/v1/chat/completions')
  expect(JSON.parse(init.body)).toMatchObject({ model: 'synthetic-openai-model', max_completion_tokens: 700 })
  expect(JSON.parse(init.body)).not.toHaveProperty('max_tokens')
  expect(JSON.parse(init.body)).not.toHaveProperty('temperature')
  if (streaming) expect(JSON.parse(init.body).stream_options).toEqual({ include_usage: true })
  else expect(JSON.parse(init.body)).not.toHaveProperty('stream_options')
  expect(mocks.finish).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org' }), { success: true, totalTokens: 99 })
  expect(init.redirect).toBe('error')
})
