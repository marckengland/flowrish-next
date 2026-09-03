import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireSession } from '@/server/auth/session'
import { requireEntitlement } from '@/server/auth/entitlements'
import { chatMessageStream } from '@/server/services/ai'
import { AppError, errorResponse } from '@/lib/errors'

const chatBodySchema = z.object({
  message: z.string().min(1, 'Message is required').max(5000, 'Message too long'),
  // Prior turns replayed for context. Capped in both count and size so a
  // client can't smuggle an oversized prompt through the history field.
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(5000),
      }),
    )
    .max(20)
    .optional(),
})

/**
 * POST /api/ai/chat — Stream a reply from the AI chatbot assistant.
 *
 * Body: { message }
 * No specific permission beyond session (any authenticated user).
 *
 * Response: a `text/event-stream` of newline-delimited SSE frames, each
 * a JSON payload of one of these shapes:
 *   { type: 'delta', text }          — an incremental chunk of the reply
 *   { type: 'done', message, action } — the final cleaned reply + action
 *   { type: 'error', message }        — a generic failure mid-stream
 *
 * Auth / validation failures happen before streaming begins and are
 * returned as ordinary JSON error responses (non-200), so the client
 * can distinguish "never started" from "failed partway".
 *
 * Validates: Requirements 8.3
 */
export async function POST(request: NextRequest) {
  let session: Awaited<ReturnType<typeof requireSession>>
  let message: string
  let history: Array<{ role: 'user' | 'assistant'; content: string }>

  try {
    session = await requireSession()
    await requireEntitlement(session.organizationId, 'ai')

    const body = await request.json()
    const parsed = chatBodySchema.parse(body)
    message = parsed.message
    history = parsed.history ?? []
  } catch (error) {
    return errorResponse(error)
  }

  const encoder = new TextEncoder()
  const send = (payload: unknown): Uint8Array =>
    encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const generator = chatMessageStream(
          message,
          session.dbUser.id,
          session.organizationId,
          history,
        )

        let result
        while (true) {
          const next = await generator.next()
          if (next.done) {
            result = next.value
            break
          }
          controller.enqueue(send(next.value))
        }

        controller.enqueue(
          send({
            type: 'done',
            message: result.message,
            action: result.action ?? null,
          }),
        )
      } catch (error) {
        const messageText =
          error instanceof AppError
            ? error.message
            : 'AI service temporarily unavailable'
        controller.enqueue(send({ type: 'error', message: messageText }))
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
