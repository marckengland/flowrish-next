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

/** A prior turn sent back to the server as context for the next reply. */
interface ChatHistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * One decoded frame from the `/api/ai/chat` SSE stream. `delta` carries
 * an incremental text chunk, `done` the final cleaned reply + action,
 * and `error` a generic failure raised partway through the stream.
 */
type StreamFrame =
  | { type: 'delta'; text: string }
  | { type: 'done'; message?: string; action?: ChatAction | null }
  | { type: 'error'; message?: string }

interface ExecuteApiResponse {
  data?: {
    success: boolean
    message: string
    data?: { path?: string; [k: string]: unknown }
  }
  error?: { code?: string; message?: string }
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

    // Snapshot prior turns as model context before appending this one.
    // Error bubbles are dropped and only the last few exchanges are kept
    // so the prompt stays bounded (the server caps this again at 20).
    const history: ChatHistoryMessage[] = turns
      .filter(
        (t): t is ChatTurn & { role: 'user' | 'assistant' } =>
          t.role === 'user' || t.role === 'assistant',
      )
      .slice(-10)
      .map((t) => ({ role: t.role, content: t.content }))

    const userTurn: ChatTurn = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: trimmed,
    }
    setTurns((prev) => [...prev, userTurn])
    setInput('')

    void streamReply(trimmed, history)
  }

  /** Aborts an in-flight reply; whatever streamed so far is kept. */
  function stop(): void {
    abortRef.current?.abort()
  }

  /**
   * Sends the message and consumes the `/api/ai/chat` SSE stream,
   * appending the assistant turn on the first token and growing its
   * content as deltas arrive. On the terminal `done` frame the streamed
   * text is replaced with the server's authoritative cleaned message and
   * any proposed action is attached.
   */
  async function streamReply(
    message: string,
    history: ChatHistoryMessage[],
  ): Promise<void> {
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
        body: JSON.stringify({ message, history }),
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
              Ask anything or request an action
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AutoConfirmToggle
            value={autoConfirm}
            onChange={setAutoConfirm}
          />
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
        {turns.length === 0 ? (
          <EmptyState onPrompt={(p) => send(p)} />
        ) : (
          turns.map((turn) => (
            <Turn
              key={turn.id}
              turn={turn}
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
          Hi there — I can pull up records, draft emails, or take actions like
          creating leads and enrolling in cadences. What do you need?
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
  onConfirm,
  onReject,
}: {
  turn: ChatTurn
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
        <div className="flex-1 space-y-2">
          <div className="rounded-xl rounded-tl-[3px] bg-muted px-3 py-2.5 text-[13px] text-foreground">
            <Markdown source={turn.content} />
          </div>
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

/**
 * Tiny markdown renderer covering the subset of formatting the assistant
 * realistically returns: headings, paragraphs, bullets, numbered lists,
 * fenced code blocks, inline code, bold, italics, and links. We avoid
 * pulling in `react-markdown` to keep the bundle thin —
 * `dangerouslySetInnerHTML` here only consumes a string we've fully
 * escaped and re-wrapped, so untrusted markup never reaches the DOM.
 */
function Markdown({ source }: { source: string }): React.JSX.Element {
  return (
    <div
      className="prose prose-sm max-w-none text-[13px] dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-1.5 prose-code:rounded prose-code:bg-background/50 prose-code:px-1"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(source) }}
    />
  )
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderInline(text: string): string {
  // 1) escape everything, then 2) re-introduce a small allowed subset.
  const escaped = escapeHtml(text)
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    )
}

function renderMarkdown(source: string): string {
  const lines = source.split(/\r?\n/)
  const out: string[] = []
  let inUl = false
  let inOl = false
  let inCode = false
  let codeLines: string[] = []
  let codeLang = ''

  function closeLists(): void {
    if (inUl) {
      out.push('</ul>')
      inUl = false
    }
    if (inOl) {
      out.push('</ol>')
      inOl = false
    }
  }

  let paragraphLines: string[] = []
  function flushParagraph(): void {
    if (paragraphLines.length === 0) return
    out.push(`<p>${renderInline(paragraphLines.join(' '))}</p>`)
    paragraphLines = []
  }

  function flushCode(): void {
    // Code block contents are escaped verbatim — never run through the
    // inline pass — so markdown-like characters inside code render as
    // typed and no markup can leak in.
    const cls = codeLang ? ` class="language-${escapeHtml(codeLang)}"` : ''
    out.push(
      `<pre><code${cls}>${escapeHtml(codeLines.join('\n'))}</code></pre>`,
    )
    codeLines = []
    codeLang = ''
  }

  for (const rawLine of lines) {
    // Fenced code blocks take precedence over every other construct so
    // that markdown syntax inside a block is preserved verbatim.
    const fenceMatch = /^\s*```(.*)$/.exec(rawLine)
    if (fenceMatch) {
      if (inCode) {
        flushCode()
        inCode = false
      } else {
        flushParagraph()
        closeLists()
        inCode = true
        codeLang = fenceMatch[1].trim()
      }
      continue
    }
    if (inCode) {
      codeLines.push(rawLine)
      continue
    }

    const line = rawLine.trimEnd()
    if (line.trim() === '') {
      flushParagraph()
      closeLists()
      continue
    }
    const headingMatch = /^\s*(#{1,6})\s+(.*)$/.exec(line)
    if (headingMatch) {
      flushParagraph()
      closeLists()
      const level = headingMatch[1].length
      out.push(`<h${level}>${renderInline(headingMatch[2])}</h${level}>`)
      continue
    }
    const ulMatch = /^\s*[-*]\s+(.*)$/.exec(line)
    const olMatch = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (ulMatch) {
      flushParagraph()
      if (inOl) {
        out.push('</ol>')
        inOl = false
      }
      if (!inUl) {
        out.push('<ul>')
        inUl = true
      }
      out.push(`<li>${renderInline(ulMatch[1])}</li>`)
      continue
    }
    if (olMatch) {
      flushParagraph()
      if (inUl) {
        out.push('</ul>')
        inUl = false
      }
      if (!inOl) {
        out.push('<ol>')
        inOl = true
      }
      out.push(`<li>${renderInline(olMatch[1])}</li>`)
      continue
    }
    closeLists()
    paragraphLines.push(line)
  }
  flushParagraph()
  closeLists()
  // Close an unterminated code fence gracefully (e.g. a streamed reply
  // that opened ``` but hasn't emitted the closing fence yet).
  if (inCode) flushCode()
  return out.join('')
}
