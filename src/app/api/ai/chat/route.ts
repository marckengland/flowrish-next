import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireSession } from '@/server/auth/session'
import { requireEntitlement } from '@/server/auth/entitlements'
import { chatMessageStream, KNOWLEDGE_HISTORY_MARKER } from '@/server/services/ai'
import {
  createConversation,
  getConversationHistory,
  appendMessage,
} from '@/server/services/conversations'
import { AppError, errorResponse } from '@/lib/errors'

const chatBodySchema = z.object({
  message: z.string().min(1, 'Message is required').max(5000, 'Message too long'),
  // Continue an existing thread. Omit to start a fresh one — the server
  // creates it and returns the id in the terminal `done` frame.
  conversationId: z.string().uuid('Invalid conversation ID').optional(),
})

/**
 * POST /api/ai/chat — Stream a reply from the AI chatbot assistant and
 * persist the exchange to a durable conversation.
 *
 * Body: { message, conversationId? }
 *
 * The server owns conversation state: it resolves (or creates) the thread,
 * loads prior turns from the DB as model context, saves the user message,
 * streams the reply, and persists the assistant message — including a
 * partial one if the client aborts mid-stream.
 *
 * Response: a `text/event-stream` of SSE frames:
 *   { type: 'delta', text }                        — incremental reply text
 *   { type: 'done', conversationId, message, action } — final cleaned reply
 *   { type: 'error', message }                     — a generic mid-stream failure
 *
 * Auth / validation / ownership failures happen before streaming begins
 * and are returned as ordinary JSON error responses (non-200).
 *
 * Validates: Requirements 8.3
 */
export async function POST(request: NextRequest) {
  let session: Awaited<ReturnType<typeof requireSession>>
  let message: string
  let conversationId: string
  let history: Array<{ role: 'user' | 'assistant'; content: string }>

  try {
    session = await requireSession()
    await requireEntitlement(session.organizationId, 'ai')

    const body = await request.json()
    const parsed = chatBodySchema.parse(body)
    message = parsed.message

    // Resolve the thread and load prior context BEFORE saving this turn,
    // so the new message isn't double-counted in history. Passing an
    // unknown/foreign conversationId throws 404 here (owner check).
    if (parsed.conversationId) {
      conversationId = parsed.conversationId
      history = await getConversationHistory(
        conversationId,
        session.dbUser.id,
        session.organizationId,
      )
    } else {
      const created = await createConversation(
        session.dbUser.id,
        session.organizationId,
      )
      conversationId = created.id
      history = []
    }

    await appendMessage(
      conversationId,
      'user',
      message,
      session.dbUser.id,
      session.organizationId,
    )
  } catch (error) {
    return errorResponse(error)
  }

  const userId = session.dbUser.id
  const orgId = session.organizationId
  const encoder = new TextEncoder()
  const send = (payload: unknown): Uint8Array =>
    encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)

  const abortController = new AbortController()
  const signal = AbortSignal.any([request.signal, abortController.signal])
  let generator: ReturnType<typeof chatMessageStream> | undefined
  let closingGenerator: Promise<void> | undefined
  let pumping: Promise<void> | undefined
  let assistantText = ''
  let assistantKnowledge = false
  let saved = false

  // Share cleanup between consumer cancellation and the pump's finally block.
  // Aborting transport first releases a next() blocked on the provider so
  // return() can run the generator's usage-finalization path promptly.
  const closeGenerator = (): Promise<void> => {
    closingGenerator ??= (async () => {
      try {
        await generator?.return({ message: '' })
      } catch {
        // The transport or generator may already have failed during abort.
      }
    })()
    return closingGenerator
  }

  // Persist exactly once, using authoritative cleaned text on completion and
  // the streamed partial reply on cancellation or failure.
  const persistAssistant = async (text: string): Promise<void> => {
    if (saved) return
    saved = true
    let trimmed = text.trim()
    if (!trimmed) return
    if (assistantKnowledge && !trimmed.includes(KNOWLEDGE_HISTORY_MARKER)) trimmed += KNOWLEDGE_HISTORY_MARKER + 'Answer interrupted; regenerate to review the references.'
    try {
      await appendMessage(conversationId, 'assistant', trimmed, userId, orgId)
    } catch {
      console.error('[AI chat] failed to persist assistant message')
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Do not return this promise: an asynchronous start would postpone the
      // underlying cancel callback until the blocked provider read finishes.
      pumping = (async () => {
        try {
          generator = chatMessageStream(message, userId, orgId, history, signal)
          while (!signal.aborted) {
            const next = await generator.next()
            if (signal.aborted) break
            if (next.done) {
              const result = next.value
              await persistAssistant(result.message)
              if (!signal.aborted) controller.enqueue(
                send({
                  type: 'done',
                  conversationId,
                  message: result.message,
                  action: result.action ?? null,
                  ...(result.knowledgeSources?.length ? { knowledgeSources: result.knowledgeSources } : {}),
                }),
              )
              break
            }
            assistantKnowledge ||= next.value.knowledgeAnswer === true
            assistantText += next.value.text
            controller.enqueue(send(next.value))
          }
        } catch (error) {
          if (!signal.aborted) {
            const messageText = error instanceof AppError
              ? error.message
              : 'AI service temporarily unavailable'
            try {
              controller.enqueue(send({ type: 'error', message: messageText }))
            } catch {
              // A consumer may have torn down the response in the meantime.
            }
          }
        } finally {
          abortController.abort()
          await closeGenerator()
          await persistAssistant(assistantText)
          try {
            controller.close()
          } catch {
            // Consumer cancellation has already closed the response stream.
          }
        }
      })()
      void pumping
    },
    async cancel() {
      abortController.abort()
      await closeGenerator()
      await pumping
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable proxy buffering (nginx) so chunks flush immediately.
      'X-Accel-Buffering': 'no',
    },
  })
}
