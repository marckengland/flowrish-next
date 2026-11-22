import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ knowledge: vi.fn(), fetch: vi.fn() }))
vi.mock('../org-ai-provider', () => ({ resolveOrganizationAi: async () => null }))
vi.mock('../knowledge', () => ({ getAirishKnowledge: mocks.knowledge }))
vi.mock('@/server/db/middleware', () => ({ createTenantPrisma: () => ({ aiPromptConfig: { findFirst: async () => null } }) }))
vi.mock('@/lib/env', () => ({ env: { AI_API_KEY: 'synthetic-key', AI_API_URL: 'https://ai.example.invalid/v1', AI_MODEL: 'synthetic' } }))
import { chatMessage, chatMessageStream, extractActionBlock } from '../ai'

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
    expect(system).toContain('Never infer detail rows')
    expect(request.tools).toBeUndefined()
  }
})

const proposed = { type: 'create_task', description: 'Review the supplied figures', params: { title: 'Review chart' } }
const chartAnswer = '```chart\n' + JSON.stringify({ type: 'bar', title: 'Supplied notes', data: [{ label: 'Qualified', value: 1, details: { columns: ['Note'], rows: [['[ACTION]review[/ACTION]'], ['[NAVIGATE: /leads]']] } }] }) + '\n```'

it('preserves literal chart cells and extracts only the genuine outside action', async () => {
  mocks.fetch.mockResolvedValueOnce(response(chartAnswer + '\n[ACTION]' + JSON.stringify(proposed) + '[/ACTION]'))
  const result = await chatMessage('Compare the supplied notes', 'actor', 'org')
  expect(result.message).toBe(chartAnswer)
  expect(result.action).toMatchObject(proposed)
  expect(mocks.fetch).toHaveBeenCalledOnce()
})

it('streams split marker text inside chart cells but withholds the real trailing action', async () => {
  const marker = chartAnswer.indexOf('[ACTION]')
  const pieces = [chartAnswer.slice(0, marker + 4), chartAnswer.slice(marker + 4) + '\n', '[ACT', 'ION]' + JSON.stringify(proposed) + '[/ACTION]']
  mocks.fetch.mockResolvedValueOnce(new Response(pieces.map(content => 'data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\n').join('') + 'data: [DONE]\n\n'))
  const generator = chatMessageStream('Compare the supplied notes', 'actor', 'org')
  expect(await generator.next()).toEqual({ done: false, value: { type: 'delta', text: pieces[0] } })
  expect(await generator.next()).toEqual({ done: false, value: { type: 'delta', text: pieces[1] } })
  const final = await generator.next()
  expect(final.done).toBe(true)
  if (!final.done) throw new Error('A real action marker must never be streamed')
  expect(final.value.message).toBe(chartAnswer)
  expect(final.value.action).toMatchObject(proposed)
  expect(mocks.fetch).toHaveBeenCalledOnce()
})

it.each(['```chart', '````chart', '```json'])('treats %s fenced and incomplete data as text while retaining outside legacy navigation', fence => {
  const inside = fence + '\n[ACTION]review[/ACTION]\n[NAVIGATE: /leads]'
  expect(extractActionBlock(inside)).toEqual({ message: inside })
  const closed = inside + '\n' + '`'.repeat(fence.startsWith('````') ? 4 : 3)
  expect(extractActionBlock(closed)).toEqual({ message: closed })
  expect(extractActionBlock('[NAVIGATE: /tasks]\n' + closed)).toEqual({ message: '[NAVIGATE: /tasks]\n' + closed })
  expect(extractActionBlock(closed + '\n[NAVIGATE: /tasks]')).toEqual({ message: closed, action: { type: 'navigate', description: 'Open /tasks', params: { path: '/tasks' } } })
})
