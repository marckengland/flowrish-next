import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ stream: vi.fn(), append: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: async () => ({ dbUser: { id: 'user' }, organizationId: 'org' }) }))
vi.mock('@/server/auth/entitlements', () => ({ requireEntitlement: async () => {} }))
vi.mock('@/server/services/ai', () => ({ chatMessageStream: mocks.stream, KNOWLEDGE_HISTORY_MARKER: '\n\nKnowledge sources:\n' }))
vi.mock('@/server/services/conversations', () => ({ createConversation: async () => ({ id: '11111111-1111-4111-8111-111111111111' }), getConversationHistory: async () => [], appendMessage: mocks.append }))
import { POST } from './route'

const threadId = '11111111-1111-4111-8111-111111111111'
const releaseStreams: Array<() => void> = []

function request(signal?: AbortSignal): NextRequest {
  return new NextRequest('http://localhost/api/ai/chat', { method: 'POST', body: JSON.stringify({ message: 'Repair prices?' }), headers: { 'content-type': 'application/json' }, signal })
}

function stalledReply() {
  let transportSignal: AbortSignal | undefined
  let finalized = false
  let stop = () => {}
  async function* reply(): AsyncGenerator<{ type: 'delta'; text: string; knowledgeAnswer: boolean }, { message: string }, unknown> {
    try {
      yield { type: 'delta', text: 'Repairs start at 500 pesos.', knowledgeAnswer: true }
      await new Promise<void>((_resolve, reject) => {
        stop = () => reject(new DOMException('Aborted', 'AbortError'))
        if (transportSignal?.aborted) stop()
        else transportSignal?.addEventListener('abort', stop, { once: true })
      })
      return { message: 'unreachable' }
    } finally {
      transportSignal?.removeEventListener('abort', stop)
      finalized = true
    }
  }
  const generator = reply()
  const returned = vi.spyOn(generator, 'return')
  mocks.stream.mockImplementation((_message, _userId, _orgId, _history, signal?: AbortSignal) => { transportSignal = signal; return generator })
  releaseStreams.push(() => stop())
  return { signal: () => transportSignal, closed: () => finalized, returned }
}

beforeEach(() => { vi.clearAllMocks(); mocks.append.mockResolvedValue(undefined) })
afterEach(() => { for (const release of releaseStreams.splice(0)) release(); vi.restoreAllMocks() })

describe('AI chat route cancellation', () => {
  it('aborts a pending provider read and closes its iterator when the response reader cancels', async () => {
    const reply = stalledReply()
    const response = await POST(request())
    const reader = response.body!.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toContain('Repairs start at 500 pesos.')
    const cancelled = reader.cancel()
    void cancelled.catch(() => {})
    await vi.waitFor(() => expect(reply.signal()?.aborted).toBe(true), { timeout: 200 })
    await cancelled
    expect(reply.closed()).toBe(true)
    expect(reply.returned).toHaveBeenCalled()
    expect(mocks.append.mock.calls.filter((call) => call[1] === 'assistant')).toEqual([
      [threadId, 'assistant', 'Repairs start at 500 pesos.\n\nKnowledge sources:\nAnswer interrupted; regenerate to review the references.', 'user', 'org'],
    ])
  })

  it('forwards the incoming request abort to a blocked provider read and persists its partial reply once', async () => {
    const requestController = new AbortController()
    const reply = stalledReply()
    const response = await POST(request(requestController.signal))
    const reader = response.body!.getReader()
    await reader.read()
    const next = reader.read()
    requestController.abort()
    await vi.waitFor(() => expect(reply.signal()?.aborted).toBe(true), { timeout: 200 })
    expect(await next).toEqual({ value: undefined, done: true })
    expect(reply.closed()).toBe(true)
    expect(reply.returned).toHaveBeenCalled()
    expect(mocks.append.mock.calls.filter((call) => call[1] === 'assistant')).toHaveLength(1)
  })

  it('keeps normal completion authoritative and persists the assistant only once', async () => {
    async function* reply(): AsyncGenerator<{ type: 'delta'; text: string }, { message: string }, unknown> {
      yield { type: 'delta', text: 'Draft reply' }
      return { message: 'Final cleaned reply' }
    }
    const generator = reply()
    const returned = vi.spyOn(generator, 'return')
    mocks.stream.mockReturnValue(generator)
    const response = await POST(request())
    const body = await response.text()
    expect(body).toContain('"type":"done"')
    expect(body).toContain('"message":"Final cleaned reply"')
    expect(returned).toHaveBeenCalled()
    expect(mocks.append.mock.calls.filter((call) => call[1] === 'assistant')).toEqual([
      [threadId, 'assistant', 'Final cleaned reply', 'user', 'org'],
    ])
  })

  it('settles cancellation after persistence failure without logging raw error details', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.append.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('fixture-provider-key-not-real'))
    const reply = stalledReply()
    const response = await POST(request())
    const reader = response.body!.getReader()
    await reader.read()
    const cancelled = reader.cancel()
    void cancelled.catch(() => {})
    await vi.waitFor(() => expect(reply.signal()?.aborted).toBe(true), { timeout: 200 })
    await cancelled
    expect(reply.closed()).toBe(true)
    expect(errorLog).toHaveBeenCalledWith('[AI chat] failed to persist assistant message')
    expect(errorLog.mock.calls.flat()).not.toContainEqual(expect.any(Error))
  })
})
