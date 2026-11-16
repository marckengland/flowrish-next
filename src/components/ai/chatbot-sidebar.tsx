'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Send,
  Square,
  X,
  XCircle,
  Zap,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ChatMessage } from '@/components/ai/chat-message'
import { KnowledgeSources, type KnowledgeReference } from '@/components/ai/knowledge-sources'
import { cn } from '@/lib/utils'
import { useLayoutStore } from '@/stores/layout'

/**
 * Airish — the AI assistant sidebar with a full action loop, quick
 * prompts, lightweight markdown rendering, and an Autopilot switch.
 *
 * Action flow:
 *   1. The user sends a message; `/api/ai/chat` streams the assistant's
 *      reply token-by-token (SSE) and ends with an optional `action`
 *      payload, so text appears progressively instead of all at once.
 *   2. If the action is `navigate`, the client handles it locally
 *      (Next router push) — no execute request needed.
 *   3. For data-mutation actions (`create_lead`, `create_task`,
 *      `update_lead_status`, `update_lead_tier`, `enroll_in_cadence`),
 *      the client posts to `/api/ai/chat/execute` which delegates to
 *      `executeChatAction` server-side. Auth + RBAC checks live in the
 *      route handler, never on the client.
 *   4. When Autopilot is on, every action — including navigation —
 *      executes the moment it arrives, with no confirmation step.
 *      Otherwise the user sees a confirm/cancel card and navigation
 *      waits for an explicit click.
 *
 * The Autopilot toggle has a short label and a help tooltip so the
 * affordance is discoverable at a glance.
 *
 * Validates: Requirements 8.3, 8.5
 */

// ─── Action types ────────────────────────────────────────────────────────────

type ChatActionType =
  | 'navigate'
  | 'create_lead'
  | 'create_task'
  | 'update_lead_status'
  | 'update_lead_tier'
  | 'enroll_in_cadence'
  | 'create_cadence'

interface NavigateAction {
  type: 'navigate'
  description: string
  params: { path: string }
}

interface CreateLeadAction {
  type: 'create_lead'
  description: string
  params: {
    firstName: string
    lastName: string
    email?: string
    phone?: string
    title?: string
    companyName?: string
    leadStatus?: string
    tier?: string
    dealValue?: number
  }
}

interface CreateTaskAction {
  type: 'create_task'
  description: string
  params: {
    title: string
    description?: string
    priority?: 'LOW' | 'MEDIUM' | 'HIGH'
    dueDate?: string
    leadId?: string
    assigneeId?: string
  }
}

interface UpdateLeadStatusAction {
  type: 'update_lead_status'
  description: string
  params: { leadId: string; leadStatus: string }
}

interface UpdateLeadTierAction {
  type: 'update_lead_tier'
  description: string
  params: { leadId: string; tier: string }
}

interface EnrollInCadenceAction {
  type: 'enroll_in_cadence'
  description: string
  params: { cadenceId: string; leadId: string }
}

interface CreateCadenceAction {
  type: 'create_cadence'
  description: string
  params: {
    name: string
    steps: Array<{
      actionType: 'EMAIL' | 'CALL' | 'LINKEDIN' | 'MANUAL_TASK'
      delayHours?: number
      subject?: string
      body?: string
      taskTitle?: string
      taskDescription?: string
    }>
  }
}

type ChatAction =
  | NavigateAction
  | CreateLeadAction
  | CreateTaskAction
  | UpdateLeadStatusAction
  | UpdateLeadTierAction
  | EnrollInCadenceAction
  | CreateCadenceAction

interface ChatTurn {
  id: string
  role: 'user' | 'assistant' | 'error'
  content: string
  action?: ChatAction
  actionStatus?: 'pending' | 'confirmed' | 'rejected' | 'executed' | 'failed'
  actionResult?: string
  knowledgeSources?: KnowledgeReference[]
  /**
   * Optional follow-up path the executor returned (e.g. the new lead's
   * detail page). Surfaced under the action result as a "Open" link so
   * the user can jump straight to the affected entity.
   */
  followUpPath?: string
}

interface ChatApiResponse {
  data?: { message: string; action?: ChatAction | null }
  error?: { code?: string; message?: string }
}

/** A persisted message as returned by the conversations API. */
interface ConversationMessageResponse {
  id: string
  role: string
  content: string
}

/** A conversation with its messages, from `/api/conversations/*`. */
interface ConversationDetailResponse {
  id: string
  title: string | null
  messages: ConversationMessageResponse[]
}

/**
 * One decoded frame from the `/api/ai/chat` SSE stream. `delta` carries
 * an incremental text chunk, `done` the final cleaned reply + action (and
 * the thread's id, needed the first time a conversation is created), and
 * `error` a generic failure raised partway through the stream.
 */
type StreamFrame =
  | { type: 'delta'; text: string }
  | {
      type: 'done'
      conversationId?: string
      message?: string
      action?: ChatAction | null
      knowledgeSources?: KnowledgeReference[]
    }
  | { type: 'error'; message?: string }

interface ExecuteApiResponse {
  data?: {
    success: boolean
    message: string
    data?: { path?: string; [k: string]: unknown }
  }
  error?: { code?: string; message?: string }
}

/**
 * Per-tab pointer to the conversation currently open in this tab. The
 * messages live in the database (durable across refreshes and devices);
 * this only remembers which thread to reopen after a reload. sessionStorage
 * (not local) means "New chat" in one tab doesn't hijack another, and the
 * pointer clears when the tab closes.
 */
const ACTIVE_CONVERSATION_KEY = 'airish:active-conversation'

function readActivePointer(): string | null {
  try {
    return sessionStorage.getItem(ACTIVE_CONVERSATION_KEY)
  } catch {
    return null
  }
}

function writeActivePointer(id: string): void {
  try {
    sessionStorage.setItem(ACTIVE_CONVERSATION_KEY, id)
  } catch {
    // Storage disabled — the thread still works, it just won't be
    // re-pinned to this tab on the next reload.
  }
}

function clearActivePointer(): void {
  try {
    sessionStorage.removeItem(ACTIVE_CONVERSATION_KEY)
  } catch {
    // Non-fatal.
  }
}

const QUICK_PROMPTS = [
  'Create a lead named Ada Lovelace at Acme',
  'Take me to the dashboard',
  'How do I send an email?',
  'What is deal health?',
]

const ACTION_LABELS: Record<ChatActionType, string> = {
  navigate: 'Navigate',
  create_lead: 'Create lead',
  create_task: 'Create task',
  update_lead_status: 'Update lead status',
  update_lead_tier: 'Update lead tier',
  enroll_in_cadence: 'Enroll in cadence',
  create_cadence: 'Create cadence',
}

export function ChatbotSidebar(): React.JSX.Element | null {
  const router = useRouter()
  const open = useLayoutStore((s) => s.chatOpen)
  const setOpen = useLayoutStore((s) => s.setChatOpen)

  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [input, setInput] = useState('')
  const [autoConfirm, setAutoConfirm] = useState(false)
  const [pending, startTransition] = useTransition()
  // `sending` covers the streamed chat round-trip; `thinking` is the
  // brief window after the request goes out but before the first token
  // lands, so the "AI is typing…" hint doesn't linger under a reply
  // that's already streaming in. `pending` still covers action execution.
  const [sending, setSending] = useState(false)
  const [thinking, setThinking] = useState(false)
  // The DB conversation this tab is attached to. Null until the first
  // message creates one (the server returns its id in the `done` frame).
  const [conversationId, setConversationId] = useState<string | null>(null)
  // True while the initial thread is being loaded from the DB on mount.
  const [hydrating, setHydrating] = useState(true)
  const busy = pending || sending

  const listRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  // Lets the Stop button abort an in-flight stream. Aborting the fetch
  // also tears down the server-side generator, so we stop paying for
  // tokens the moment the user bails.
  const abortRef = useRef<AbortController | null>(null)

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  // Stick to the bottom as turns arrive AND as a reply streams in.
  // Depending on the whole `turns` array (new reference per update) keeps
  // the view pinned to the growing assistant message, not just new turns.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [turns, thinking])

  // Focus the textarea when the panel opens.
  useEffect(() => {
    if (open) textareaRef.current?.focus()
  }, [open])

  // Abort any in-flight stream if the component unmounts.
  useEffect(() => () => abortRef.current?.abort(), [])

  // Restore the thread from the DB on mount. If this tab has a pointer to
  // a specific conversation we reopen that; otherwise we load the user's
  // most recent one. Messages are durable server-side, so this survives
  // refreshes, new tabs, and other devices — not just a single tab.
  useEffect(() => {
    let cancelled = false

    async function hydrate(): Promise<void> {
      const pointer = readActivePointer()
      const url = pointer
        ? `/api/conversations/${pointer}`
        : '/api/conversations/latest'
      try {
        const res = await fetch(url, {
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        })
        if (!res.ok) {
          // Stale pointer (deleted/foreign thread) or no AI access — drop
          // the pointer and start clean rather than surfacing an error.
          if (pointer) clearActivePointer()
          return
        }
        const body = (await res.json().catch(() => ({}))) as {
          data?: ConversationDetailResponse | null
        }
        const convo = body.data
        if (cancelled || !convo) return
        setConversationId(convo.id)
        writeActivePointer(convo.id)
        setTurns(
          convo.messages.map((m) => ({
            id: m.id,
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content,
          })),
        )
      } catch {
        // Network error — leave the panel empty; a new chat still works.
      } finally {
        if (!cancelled) setHydrating(false)
      }
    }

    void hydrate()
    return () => {
      cancelled = true
    }
  }, [])

  if (!open) return null

  function executeAction(turnId: string, action: ChatAction): void {
    setTurns((prev) =>
      prev.map((t) =>
        t.id === turnId ? { ...t, actionStatus: 'confirmed' } : t,
      ),
    )

    // Navigate actions never hit the executor route — handle locally.
    if (action.type === 'navigate') {
      try {
        router.push(action.params.path)
        setTurns((prev) =>
          prev.map((t) =>
            t.id === turnId
              ? {
                  ...t,
                  actionStatus: 'executed',
                  actionResult: `Navigated to ${action.params.path}`,
                }
              : t,
          ),
        )
      } catch (err) {
        setTurns((prev) =>
          prev.map((t) =>
            t.id === turnId
              ? {
                  ...t,
                  actionStatus: 'failed',
                  actionResult:
                    err instanceof Error ? err.message : 'Navigation failed',
                }
              : t,
          ),
        )
      }
      return
    }

    // All other actions go through the server-side executor.
    startTransition(async () => {
      try {
        const res = await fetch('/api/ai/chat/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ action }),
        })
        const body = (await res.json().catch(() => ({}))) as ExecuteApiResponse

        if (!res.ok) {
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    actionStatus: 'failed',
                    actionResult:
                      body.error?.message ?? `Failed (${res.status})`,
                  }
                : t,
            ),
          )
          return
        }

        const result = body.data
        if (!result || !result.success) {
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    actionStatus: 'failed',
                    actionResult: result?.message ?? 'Action failed',
                  }
                : t,
            ),
          )
          return
        }

        const followUpPath = typeof result.data?.path === 'string'
          ? result.data.path
          : undefined

        setTurns((prev) =>
          prev.map((t) =>
            t.id === turnId
              ? {
                  ...t,
                  actionStatus: 'executed',
                  actionResult: result.message,
                  followUpPath,
                }
              : t,
          ),
        )
      } catch (err) {
        setTurns((prev) =>
          prev.map((t) =>
            t.id === turnId
              ? {
                  ...t,
                  actionStatus: 'failed',
                  actionResult:
                    err instanceof Error ? err.message : 'Action failed',
                }
              : t,
          ),
        )
      }
    })
  }

  function rejectAction(turnId: string): void {
    setTurns((prev) =>
      prev.map((t) =>
        t.id === turnId
          ? { ...t, actionStatus: 'rejected', actionResult: 'Action cancelled.' }
          : t,
      ),
    )
  }

  function send(text?: string): void {
    const trimmed = (text ?? input).trim()
    if (!trimmed || busy) return

    const userTurn: ChatTurn = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: trimmed,
    }
    setTurns((prev) => [...prev, userTurn])
    setInput('')

    void streamReply(trimmed)
  }

  /** Aborts an in-flight reply; whatever streamed so far is kept. */
  function stop(): void {
    abortRef.current?.abort()
  }

  /**
   * Starts a fresh chat. The current thread stays saved in the DB; we just
   * detach this tab from it. A new conversation is created lazily on the
   * next send (the server returns its id), so refreshing before sending
   * won't strand an empty thread.
   */
  function newChat(): void {
    abortRef.current?.abort()
    setTurns([])
    setInput('')
    setConversationId(null)
    clearActivePointer()
    textareaRef.current?.focus()
  }

  /**
   * Sends the message and consumes the `/api/ai/chat` SSE stream,
   * appending the assistant turn on the first token and growing its
   * content as deltas arrive. On the terminal `done` frame the streamed
   * text is replaced with the server's authoritative cleaned message and
   * any proposed action is attached.
   */
  async function streamReply(message: string): Promise<void> {
    const assistantId = `a-${Date.now()}`
    let assistantCreated = false
    let streamed = ''
    let finalAction: ChatAction | null = null
    let streamError: string | null = null

    const controller = new AbortController()
    abortRef.current = controller

    const pushError = (content: string): void => {
      setTurns((prev) => [
        ...prev,
        { id: `e-${Date.now()}`, role: 'error', content },
      ])
    }

    const ensureAssistant = (): void => {
      if (assistantCreated) return
      assistantCreated = true
      setThinking(false)
      setTurns((prev) => [
        ...prev,
        { id: assistantId, role: 'assistant', content: '' },
      ])
    }

    setSending(true)
    setThinking(true)
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          message,
          conversationId: conversationId ?? undefined,
        }),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as ChatApiResponse
        pushError(body.error?.message ?? 'AI service temporarily unavailable')
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      const handleFrame = (raw: string): void => {
        const dataLine = raw
          .split('\n')
          .find((line) => line.startsWith('data:'))
        if (!dataLine) return
        let payload: StreamFrame
        try {
          payload = JSON.parse(dataLine.slice(5).trim()) as StreamFrame
        } catch {
          return
        }
        if (payload.type === 'delta') {
          ensureAssistant()
          streamed += payload.text
          const content = streamed
          setTurns((prev) =>
            prev.map((t) => (t.id === assistantId ? { ...t, content } : t)),
          )
        } else if (payload.type === 'done') {
          ensureAssistant()
          // First turn of a brand-new thread: adopt the server's id so
          // subsequent sends continue it and a refresh reopens it.
          if (payload.conversationId && payload.conversationId !== conversationId) {
            setConversationId(payload.conversationId)
            writeActivePointer(payload.conversationId)
          }
          finalAction = sanitizeAction(payload.action ?? null)
          const finalMessage = (payload.message ?? streamed).trim()
          const action = finalAction
          setTurns((prev) =>
            prev.map((t) =>
              t.id === assistantId
                ? {
                    ...t,
                    content: finalMessage,
                    action: action ?? undefined,
                    actionStatus: action ? 'pending' : undefined,
                    knowledgeSources: Array.isArray(payload.knowledgeSources) ? payload.knowledgeSources.filter(source => source && typeof source.id === 'string' && typeof source.title === 'string' && typeof source.category === 'string' && Number.isInteger(source.revision) && source.revision > 0).slice(0, 6) : undefined,
                  }
                : t,
            ),
          )
        } else if (payload.type === 'error') {
          streamError = payload.message ?? 'AI service temporarily unavailable'
        }
      }

      // Drain complete SSE frames (blank-line separated) as they arrive.
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let sep: number
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          handleFrame(buffer.slice(0, sep))
          buffer = buffer.slice(sep + 2)
        }
      }
      if (buffer.trim()) handleFrame(buffer)

      if (streamError) {
        // A mid-stream failure with nothing shown yet reads best as a
        // plain error bubble; if text already streamed, surface the
        // error beneath it so the partial reply isn't silently dropped.
        pushError(streamError)
        return
      }
      if (!assistantCreated) {
        pushError('AI service temporarily unavailable')
        return
      }

      // Autopilot runs every action the moment it arrives — including
      // navigation — with no confirmation step. This is the explicit
      // "hands-off" mode the user opts into via the toggle.
      if (finalAction && autoConfirm) {
        const action = finalAction
        window.setTimeout(() => executeAction(assistantId, action), 0)
      }
    } catch (err) {
      // User-initiated stop: keep whatever streamed, no error bubble.
      // An empty aborted turn is dropped so we don't leave a blank card.
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (assistantCreated && streamed.trim() === '') {
          setTurns((prev) => prev.filter((t) => t.id !== assistantId))
        }
      } else if (!assistantCreated) {
        pushError('AI service temporarily unavailable')
      } else {
        pushError('The reply was interrupted. Please try again.')
      }
    } finally {
      abortRef.current = null
      setSending(false)
      setThinking(false)
    }
  }

  function onTextareaKeyDown(
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  }

  return (
    <>
      {/* Scrim overlay behind the drawer. Tapping outside dismisses it. */}
      <div
        aria-hidden="true"
        onClick={() => setOpen(false)}
        className="fixed inset-0 z-40 bg-black/[0.28]"
      />
      <aside
        aria-label="Airish assistant"
        role="complementary"
        className="fixed inset-y-0 right-0 z-50 flex w-[min(392px,calc(100vw-2rem))] flex-col border-l bg-card shadow-[-24px_0_60px_-24px_rgba(0,0,0,0.28)]"
      >
      <header className="flex h-[60px] shrink-0 items-center justify-between border-b px-[18px]">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-[9px] bg-brand-subtle text-brand-emphasis"
          >
            <Bot className="size-[17px]" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold">Airish</p>
            <p className="text-[11.5px] text-muted-foreground">
              Help with your sales work
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AutoConfirmToggle
            value={autoConfirm}
            onChange={setAutoConfirm}
          />
          {turns.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] text-muted-foreground"
              onClick={newChat}
              title="Start a new conversation"
            >
              New chat
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setOpen(false)}
            aria-label="Close Airish"
            title="Close"
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </header>

      <div
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-busy={busy || undefined}
        className="flex-1 space-y-3.5 overflow-y-auto p-[18px]"
      >
        {hydrating && turns.length === 0 ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
            Loading your conversation…
          </p>
        ) : turns.length === 0 ? (
          <EmptyState onPrompt={(p) => send(p)} />
        ) : (
          turns.map((turn) => (
            <Turn
              key={turn.id}
              turn={turn}
              streaming={sending && turn === turns.at(-1)}
              onConfirm={() => turn.action && executeAction(turn.id, turn.action)}
              onReject={() => rejectAction(turn.id)}
            />
          ))
        )}
        {thinking || pending ? (
          <p
            className="flex items-center gap-2 text-xs text-muted-foreground"
            aria-live="polite"
          >
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
            {pending ? 'Working…' : 'AI is thinking…'}
          </p>
        ) : null}
      </div>

      <form
        className="border-t p-3.5"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        {autoConfirm && (
          <p className="mb-2 flex items-center gap-1.5 text-[10.5px] text-warning-foreground">
            <Zap className="size-3" aria-hidden="true" />
            Autopilot is ON — actions run without asking
          </p>
        )}
        <label htmlFor="chatbot-input" className="sr-only">
          Message
        </label>
        <div className="flex items-end gap-2.5">
          <textarea
            id="chatbot-input"
            ref={textareaRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onTextareaKeyDown}
            rows={2}
            placeholder="Ask Airish…"
            disabled={busy}
            className="flex-1 resize-none rounded-[10px] border border-input bg-card px-3 py-2.5 text-sm shadow-sm transition-[color,box-shadow,border-color] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand/15 disabled:cursor-not-allowed disabled:opacity-50"
          />
          {sending ? (
            <Button
              type="button"
              size="icon-lg"
              variant="secondary"
              className="rounded-[10px]"
              onClick={stop}
              aria-label="Stop generating"
              title="Stop"
            >
              <Square className="size-3.5 fill-current" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon-lg"
              className="rounded-[10px]"
              disabled={busy || input.trim().length === 0}
              aria-label="Send message"
              title="Send"
            >
              <Send className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>
        <p className="mt-2 text-[10.5px] text-muted-foreground">
          Enter to send · Shift+Enter for a new line
        </p>
      </form>
      </aside>
    </>
  )
}

// ─── Auto-confirm toggle ─────────────────────────────────────────────────────

function AutoConfirmToggle({
  value,
  onChange,
}: {
  value: boolean
  onChange: (next: boolean) => void
}): React.JSX.Element {
  return (
    <label
      className="flex select-none items-center gap-1.5 text-[11px] text-muted-foreground"
      title={
        value
          ? 'Autopilot is ON: every action (including navigation) runs immediately without asking.'
          : 'Autopilot is OFF: actions wait for your explicit confirm click.'
      }
    >
      <span>Autopilot</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label="Autopilot: run actions without confirmation"
        onClick={() => onChange(!value)}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          value ? 'bg-warning' : 'bg-muted',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'inline-block size-3.5 rounded-full bg-white shadow transition-transform',
            value ? 'translate-x-[18px]' : 'translate-x-[3px]',
          )}
        />
      </button>
    </label>
  )
}

/**
 * Validates the action payload coming back from the chat endpoint and
 * narrows it to one of the supported `ChatAction` variants. Defensive:
 * the server already sanitizes, but we re-check on the client so a
 * misbehaving model can't push an action variant the UI doesn't know
 * how to render.
 */
function sanitizeAction(action: ChatAction | null): ChatAction | null {
  if (!action || typeof action !== 'object') return null
  const type = action.type
  switch (type) {
    case 'navigate':
      return typeof action.params?.path === 'string'
        && action.params.path.startsWith('/')
        ? action
        : null
    case 'create_lead':
      return action.params?.firstName && action.params?.lastName ? action : null
    case 'create_task':
      return action.params?.title ? action : null
    case 'update_lead_status':
      return action.params?.leadId && action.params?.leadStatus
        ? action
        : null
    case 'update_lead_tier':
      return action.params?.leadId && action.params?.tier ? action : null
    case 'enroll_in_cadence':
      return action.params?.cadenceId && action.params?.leadId ? action : null
    case 'create_cadence':
      return action.params?.name
        && Array.isArray(action.params?.steps)
        && action.params.steps.length > 0
        ? action
        : null
    default:
      return null
  }
}

function EmptyState({
  onPrompt,
}: {
  onPrompt: (text: string) => void
}): React.JSX.Element {
  return (
    <div className="space-y-3.5">
      <div className="flex gap-2.5">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-[26px] shrink-0 items-center justify-center rounded-full bg-muted text-foreground"
        >
          <Bot className="size-3.5" />
        </span>
        <div className="rounded-xl rounded-tl-[3px] bg-muted px-3 py-2.5 text-[13px] leading-relaxed text-foreground">
          I can compare figures you share, draft emails, and propose CRM changes.
          What do you need help with?
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {QUICK_PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPrompt(p)}
            className="rounded-[9px] border bg-card px-3 py-2 text-left text-[12.5px] transition-colors hover:bg-muted/50"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  )
}

function Turn({
  turn,
  streaming,
  onConfirm,
  onReject,
}: {
  turn: ChatTurn
  streaming: boolean
  onConfirm: () => void
  onReject: () => void
}): React.JSX.Element {
  const router = useRouter()

  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-xl rounded-tr-[3px] bg-foreground px-3 py-2.5 text-[13px] text-background">
          <p className="whitespace-pre-wrap break-words">{turn.content}</p>
        </div>
      </div>
    )
  }
  if (turn.role === 'error') {
    return (
      <div role="alert" className="flex justify-start">
        <div className="max-w-[85%] rounded-xl border border-danger/30 bg-danger-subtle px-3 py-2.5 text-[13px] text-danger-foreground">
          <p>{turn.content}</p>
        </div>
      </div>
    )
  }
  return (
    <div className="flex justify-start">
      <div className="flex w-full max-w-[90%] items-start gap-2.5">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-[26px] shrink-0 items-center justify-center rounded-full bg-muted text-foreground"
        >
          <Bot className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="rounded-xl rounded-tl-[3px] bg-muted px-3 py-2.5 text-[13px] text-foreground">
            <ChatMessage source={turn.content} streaming={streaming} />
          </div>
          <KnowledgeSources sources={turn.knowledgeSources ?? []} />
          {turn.action && turn.actionStatus === 'pending' && (
            <ActionCard
              action={turn.action}
              onConfirm={onConfirm}
              onReject={onReject}
            />
          )}
          {turn.action && turn.actionStatus && turn.actionStatus !== 'pending' && (
            <ActionStatusBadge
              status={turn.actionStatus}
              result={turn.actionResult}
              followUpPath={turn.followUpPath}
              onFollowUp={
                turn.followUpPath
                  ? () => router.push(turn.followUpPath!)
                  : undefined
              }
            />
          )}
        </div>
      </div>
    </div>
  )
}

function ActionCard({
  action,
  onConfirm,
  onReject,
}: {
  action: ChatAction
  onConfirm: () => void
  onReject: () => void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="rounded-[10px] border border-warning bg-warning-subtle p-[11px]">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-warning-foreground">
        <Zap className="size-3.5" aria-hidden="true" />
        <span>{ACTION_LABELS[action.type] ?? 'Run action'}: </span>
        <span className="font-normal">{action.description}</span>
      </div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-1 flex items-center gap-1 text-[10px] text-warning-foreground hover:underline"
      >
        {expanded ? (
          <ChevronUp className="size-3" />
        ) : (
          <ChevronDown className="size-3" />
        )}
        {expanded ? 'Hide details' : 'Show details'}
      </button>
      {expanded && (
        <pre className="mt-1 break-words rounded bg-warning/10 p-1.5 font-mono text-[10px] text-warning-foreground">
          {action.type}: {JSON.stringify(action.params, null, 2)}
        </pre>
      )}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12px] font-semibold text-brand-foreground transition-colors hover:bg-brand-hover"
        >
          <Check className="size-3" aria-hidden="true" /> Confirm
        </button>
        <button
          type="button"
          onClick={onReject}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[12px] font-semibold text-foreground/70 transition-colors hover:bg-muted"
        >
          <XCircle className="size-3" aria-hidden="true" /> Cancel
        </button>
      </div>
    </div>
  )
}

function ActionStatusBadge({
  status,
  result,
  followUpPath,
  onFollowUp,
}: {
  status: NonNullable<ChatTurn['actionStatus']>
  result?: string
  followUpPath?: string
  onFollowUp?: () => void
}): React.JSX.Element {
  const map: Record<
    NonNullable<ChatTurn['actionStatus']>,
    { className: string; icon: React.ReactNode }
  > = {
    pending: {
      className: 'border-border bg-muted text-muted-foreground',
      icon: <Loader2 className="size-3 animate-spin" aria-hidden="true" />,
    },
    confirmed: {
      className: 'border-border bg-muted text-muted-foreground',
      icon: <Loader2 className="size-3 animate-spin" aria-hidden="true" />,
    },
    executed: {
      className: 'border-brand/30 bg-brand-subtle text-brand-emphasis',
      icon: <Check className="size-3" aria-hidden="true" />,
    },
    rejected: {
      className: 'border-border bg-muted text-muted-foreground',
      icon: <XCircle className="size-3" aria-hidden="true" />,
    },
    failed: {
      className: 'border-danger/30 bg-danger-subtle text-danger-foreground',
      icon: <XCircle className="size-3" aria-hidden="true" />,
    },
  }
  const cfg = map[status]
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-[10px] border px-2.5 py-1.5 text-[11px]',
        cfg.className,
      )}
    >
      <span className="flex items-center gap-1">
        {cfg.icon}
        <span>{result ?? statusFallback(status)}</span>
      </span>
      {followUpPath && status === 'executed' && onFollowUp ? (
        <button
          type="button"
          onClick={onFollowUp}
          className="ml-auto rounded border border-current/30 px-1.5 py-0.5 text-[10px] font-medium hover:bg-current/10"
        >
          Open
        </button>
      ) : null}
    </div>
  )
}

function statusFallback(status: NonNullable<ChatTurn['actionStatus']>): string {
  switch (status) {
    case 'executed':
      return 'Done.'
    case 'rejected':
      return 'Action cancelled.'
    case 'failed':
      return 'Action failed.'
    default:
      return 'Executing…'
  }
}
