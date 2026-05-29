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
  User,
  X,
  XCircle,
  Zap,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useLayoutStore } from '@/stores/layout'

/**
 * Chatbot sidebar with action loop, quick prompts, and lightweight
 * markdown rendering.
 *
 * Each turn from the assistant can optionally include a `Navigate`
 * action that the user can confirm to jump to a route. When auto-confirm
 * is on, navigate actions execute immediately without prompting. The
 * frame intentionally only ships navigate actions today — adding entity
 * mutations would require a dedicated, audit-aware execute endpoint and
 * is tracked separately.
 *
 * The component never displays raw exception details; failure modes use
 * the generic `AI service temporarily unavailable` fallback so callers
 * can swap chat providers without leaking internals (Requirement 8.5).
 *
 * Validates: Requirements 8.3, 8.5
 */

interface NavigateAction {
  type: 'navigate'
  description: string
  params: { path: string }
}

type ChatAction = NavigateAction

interface ChatTurn {
  id: string
  role: 'user' | 'assistant' | 'error'
  content: string
  action?: ChatAction
  actionStatus?: 'pending' | 'confirmed' | 'rejected' | 'executed' | 'failed'
  actionResult?: string
}

interface ChatApiResponse {
  data?: { message: string; action?: ChatAction | null }
  error?: { code?: string; message?: string }
}

const QUICK_PROMPTS = [
  'Summarise my open deals',
  'Take me to the dashboard',
  'How do I send an email?',
  'What is deal health?',
]

export function ChatbotSidebar(): React.JSX.Element | null {
  const router = useRouter()
  const open = useLayoutStore((s) => s.chatOpen)
  const setOpen = useLayoutStore((s) => s.setChatOpen)

  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [input, setInput] = useState('')
  const [autoConfirm, setAutoConfirm] = useState(false)
  const [pending, startTransition] = useTransition()

  const listRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  // Stick to the bottom when new turns arrive.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [turns.length])

  // Focus the textarea when the panel opens.
  useEffect(() => {
    if (open) textareaRef.current?.focus()
  }, [open])

  if (!open) return null

  function executeAction(turnId: string, action: ChatAction): void {
    setTurns((prev) =>
      prev.map((t) => (t.id === turnId ? { ...t, actionStatus: 'confirmed' } : t)),
    )
    if (action.type === 'navigate') {
      const path = action.params.path
      try {
        router.push(path)
        setTurns((prev) =>
          prev.map((t) =>
            t.id === turnId
              ? { ...t, actionStatus: 'executed', actionResult: `Navigated to ${path}` }
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
    }
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
    if (!trimmed || pending) return

    const userTurn: ChatTurn = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: trimmed,
    }
    setTurns((prev) => [...prev, userTurn])
    setInput('')

    startTransition(async () => {
      try {
        const res = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ message: trimmed }),
        })

        const body = (await res.json().catch(() => ({}))) as ChatApiResponse

        if (!res.ok) {
          setTurns((prev) => [
            ...prev,
            {
              id: `e-${Date.now()}`,
              role: 'error',
              content: body.error?.message ?? 'AI service temporarily unavailable',
            },
          ])
          return
        }

        const message = body.data?.message?.trim()
        if (!message) {
          setTurns((prev) => [
            ...prev,
            {
              id: `e-${Date.now()}`,
              role: 'error',
              content: 'AI service temporarily unavailable',
            },
          ])
          return
        }

        const action = sanitizeAction(body.data?.action ?? null)
        const assistantId = `a-${Date.now()}`
        setTurns((prev) => [
          ...prev,
          {
            id: assistantId,
            role: 'assistant',
            content: message,
            action: action ?? undefined,
            actionStatus: action ? 'pending' : undefined,
          },
        ])
        if (action && autoConfirm) {
          // Defer one tick so React commits the new turn before we mutate it.
          window.setTimeout(() => executeAction(assistantId, action), 0)
        }
      } catch {
        setTurns((prev) => [
          ...prev,
          {
            id: `e-${Date.now()}`,
            role: 'error',
            content: 'AI service temporarily unavailable',
          },
        ])
      }
    })
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
    <aside
      aria-label="AI assistant"
      role="complementary"
      className="flex h-full w-80 shrink-0 flex-col border-l bg-background shadow-sm sm:w-96"
    >
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary"
          >
            <Bot className="size-4" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold">AI Assistant</p>
            <p className="text-xs text-muted-foreground">
              Ask anything or request an action
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAutoConfirm((v) => !v)}
            title={
              autoConfirm
                ? 'Auto-confirm ON — actions execute without asking'
                : 'Auto-confirm OFF — actions require confirmation'
            }
            className={cn(
              'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
              autoConfirm ? 'bg-amber-500' : 'bg-muted',
            )}
            aria-pressed={autoConfirm}
            aria-label="Toggle auto-confirm"
          >
            <span
              aria-hidden="true"
              className={cn(
                'inline-block size-3.5 rounded-full bg-white shadow transition-transform',
                autoConfirm ? 'translate-x-[18px]' : 'translate-x-[3px]',
              )}
            />
          </button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setOpen(false)}
            aria-label="Close AI assistant"
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
        aria-busy={pending || undefined}
        className="flex-1 space-y-3 overflow-y-auto p-4"
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
        {pending ? (
          <p
            className="flex items-center gap-2 text-xs text-muted-foreground"
            aria-live="polite"
          >
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
            AI is typing…
          </p>
        ) : null}
      </div>

      <form
        className="border-t p-3"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        {autoConfirm && (
          <p className="mb-1.5 flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
            <Zap className="size-3" aria-hidden="true" />
            Auto-confirm ON — actions will execute immediately
          </p>
        )}
        <label htmlFor="chatbot-input" className="sr-only">
          Message
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id="chatbot-input"
            ref={textareaRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onTextareaKeyDown}
            rows={2}
            placeholder="Ask the assistant…"
            disabled={pending}
            className="flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
          <Button
            type="submit"
            size="icon-sm"
            disabled={pending || input.trim().length === 0}
            aria-label="Send message"
            title="Send"
          >
            <Send className="size-4" aria-hidden="true" />
          </Button>
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">
          Press Enter to send. Shift+Enter for a new line.
        </p>
      </form>
    </aside>
  )
}

/**
 * Validates the action payload coming back from the chat endpoint. The
 * server may not return one at all today, but we want to be ready for
 * the future shape and reject anything outside the allowlist defensively
 * so a misbehaving model can't push a `delete` action onto the user.
 */
function sanitizeAction(action: ChatAction | null): ChatAction | null {
  if (!action || typeof action !== 'object') return null
  if (action.type !== 'navigate') return null
  const path = action.params?.path
  if (typeof path !== 'string' || !path.startsWith('/')) return null
  return {
    type: 'navigate',
    description: typeof action.description === 'string' ? action.description : 'Navigate',
    params: { path },
  }
}

function EmptyState({
  onPrompt,
}: {
  onPrompt: (text: string) => void
}): React.JSX.Element {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
        <Bot
          className="mx-auto mb-2 size-5 text-muted-foreground/70"
          aria-hidden="true"
        />
        <p className="font-medium text-foreground">How can I help?</p>
        <p className="mt-1 text-xs">
          Ask a question or request an action — try one of these prompts.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        {QUICK_PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPrompt(p)}
            className="rounded-lg border bg-card px-2.5 py-1.5 text-left text-[12px] transition-colors hover:bg-muted/40"
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
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="flex max-w-[85%] items-start gap-2">
          <div className="rounded-lg rounded-tr-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
            <p className="whitespace-pre-wrap break-words">{turn.content}</p>
          </div>
          <span
            aria-hidden="true"
            className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
          >
            <User className="size-3.5" />
          </span>
        </div>
      </div>
    )
  }
  if (turn.role === 'error') {
    return (
      <div role="alert" className="flex justify-start">
        <div className="max-w-[85%] rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <p>{turn.content}</p>
        </div>
      </div>
    )
  }
  return (
    <div className="flex justify-start">
      <div className="flex w-full max-w-[90%] items-start gap-2">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-foreground"
        >
          <Bot className="size-3.5" />
        </span>
        <div className="flex-1 space-y-2">
          <div className="rounded-lg rounded-tl-sm bg-muted px-3 py-2 text-sm text-foreground">
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
    <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 dark:border-amber-800 dark:bg-amber-950/30">
      <div className="flex items-center gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-200">
        <Zap className="size-3" aria-hidden="true" />
        {action.description}
      </div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-1 flex items-center gap-1 text-[10px] text-amber-700 hover:underline dark:text-amber-300"
      >
        {expanded ? (
          <ChevronUp className="size-3" />
        ) : (
          <ChevronDown className="size-3" />
        )}
        {expanded ? 'Hide details' : 'Show details'}
      </button>
      {expanded && (
        <pre className="mt-1 break-words rounded bg-amber-100/50 p-1.5 font-mono text-[10px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          {action.type}: {JSON.stringify(action.params, null, 2)}
        </pre>
      )}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className="flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-700"
        >
          <Check className="size-3" aria-hidden="true" /> Confirm
        </button>
        <button
          type="button"
          onClick={onReject}
          className="flex items-center gap-1 rounded bg-destructive px-2 py-1 text-[11px] font-medium text-destructive-foreground hover:bg-destructive/90"
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
}: {
  status: NonNullable<ChatTurn['actionStatus']>
  result?: string
}): React.JSX.Element {
  const map: Record<
    NonNullable<ChatTurn['actionStatus']>,
    { className: string; icon: React.ReactNode }
  > = {
    pending: {
      className: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200',
      icon: <Loader2 className="size-3 animate-spin" aria-hidden="true" />,
    },
    confirmed: {
      className: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200',
      icon: <Loader2 className="size-3 animate-spin" aria-hidden="true" />,
    },
    executed: {
      className:
        'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200',
      icon: <Check className="size-3" aria-hidden="true" />,
    },
    rejected: {
      className: 'border-border bg-muted text-muted-foreground',
      icon: <XCircle className="size-3" aria-hidden="true" />,
    },
    failed: {
      className:
        'border-destructive/30 bg-destructive/5 text-destructive',
      icon: <XCircle className="size-3" aria-hidden="true" />,
    },
  }
  const cfg = map[status]
  return (
    <div
      className={cn(
        'flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[11px]',
        cfg.className,
      )}
    >
      {cfg.icon}
      <span>{result ?? statusFallback(status)}</span>
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
 * realistically returns: paragraphs, bullets, numbered lists, inline
 * code, bold, italics, and links. We avoid pulling in `react-markdown`
 * to keep the bundle thin — `dangerouslySetInnerHTML` here only consumes
 * a string we've fully escaped and re-wrapped, so untrusted markup
 * never reaches the DOM.
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

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (line.trim() === '') {
      flushParagraph()
      closeLists()
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
  return out.join('')
}
