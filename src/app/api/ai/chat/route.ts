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

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let assistantText = ''
      let assistantKnowledge = false
      let saved = false

      // Persist the assistant turn exactly once — on clean completion with
      // the authoritative cleaned message, or on abort/error with whatever
      // streamed so far (already action-block-stripped by the generator).
      const persistAssistant = async (text: string): Promise<void> => {
        if (saved) return
        saved = true
        let trimmed = text.trim()
        if (!trimmed) return
        if (assistantKnowledge && !trimmed.includes(KNOWLEDGE_HISTORY_MARKER)) trimmed += KNOWLEDGE_HISTORY_MARKER + 'Answer interrupted; regenerate to review the references.'
        try {
          await appendMessage(conversationId, 'assistant', trimmed, userId, orgId)
        } catch (err) {
          console.error('[AI chat] failed to persist assistant message:', err)
        }
      }

      try {
        const generator = chatMessageStream(message, userId, orgId, history)

        let result
        while (true) {
          const next = await generator.next()
          if (next.done) {
            result = next.value
            break
          }
          assistantKnowledge ||= next.value.knowledgeAnswer === true
          assistantText += next.value.text
          controller.enqueue(send(next.value))
        }

        await persistAssistant(result.message)
        controller.enqueue(
          send({
            type: 'done',
            conversationId,
            message: result.message,
            action: result.action ?? null,
            ...(result.knowledgeSources?.length ? { knowledgeSources: result.knowledgeSources } : {}),
          }),
        )
      } catch (error) {
        // Save the partial reply so an aborted stream still leaves a
        // coherent thread on the next load.
        await persistAssistant(assistantText)
        const messageText =
          error instanceof AppError
            ? error.message
            : 'AI service temporarily unavailable'
        try {
          controller.enqueue(send({ type: 'error', message: messageText }))
        } catch {
          // Stream already torn down by the client — nothing to report to.
        }
      } finally {
        controller.close()
      }
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
