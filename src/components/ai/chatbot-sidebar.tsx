'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Bot, Send, User, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useLayoutStore } from '@/stores/layout'

/**
 * Single turn in the chat transcript. `assistant` turns come from the
 * `/api/ai/chat` response; `error` turns render the generic fallback
 * from the server without exposing internals (Requirement 8.5).
 */
interface ChatTurn {
  id: string
  role: 'user' | 'assistant' | 'error'
  content: string
}

interface ChatApiResponse {
  data?: { message: string }
  error?: { code?: string; message?: string }
}

/**
 * Persistent AI chatbot sidebar rendered by the dashboard `Shell`.
 *
 * Visibility is driven by the Zustand `layout` store (`chatOpen`), so the
 * panel is reachable from every page via the header's chat toggle
 * (Requirement 8.3). Messages are posted to `POST /api/ai/chat`, which
 * forwards to the `chatMessage` service and returns a structured
 * `{ message }` payload. Any failure is surfaced with the server-provided
 * generic message — the UI never displays raw fetch/exception details
 * (Requirement 8.5).
 *
 * Keyboard support:
 * - `Escape` closes the panel
 * - `Enter` submits the message (Shift+Enter inserts a newline)
 *
 * Accessibility:
 * - Declared as a complementary landmark with a labelled region
 * - Live region announces new assistant replies
 * - Close button is keyboard reachable and labelled for screen readers
 *
 * Validates: Requirements 8.3, 8.5
 */
export function ChatbotSidebar(): React.JSX.Element | null {
  const open = useLayoutStore((s) => s.chatOpen)
  const setOpen = useLayoutStore((s) => s.setChatOpen)

  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [input, setInput] = useState('')
  const [pending, startTransition] = useTransition()

  const listRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // Close on Escape whenever the panel is open.
  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  // Keep the transcript scrolled to the latest turn whenever it grows.
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [turns.length])

  // Focus the input whenever the panel opens so users can type right away.
  useEffect(() => {
    if (open) {
      textareaRef.current?.focus()
    }
  }, [open])

  if (!open) return null

  function send(): void {
    const trimmed = input.trim()
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

        // Parse once so we can read `data` on success and `error.message`
        // on failure without exposing any lower-level exception details.
        const body = (await res.json().catch(() => ({}))) as ChatApiResponse

        if (!res.ok) {
          setTurns((prev) => [
            ...prev,
            {
              id: `e-${Date.now()}`,
              role: 'error',
              content:
                body.error?.message ?? 'AI service temporarily unavailable',
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

        setTurns((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, role: 'assistant', content: message },
        ])
      } catch {
        // Network/unknown errors — surface the generic message only.
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
            <p className="text-xs text-muted-foreground">Ask anything or request an action</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setOpen(false)}
          aria-label="Close AI assistant"
          title="Close"
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </header>

      <div
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-busy={pending || undefined}
        className="flex-1 space-y-3 overflow-y-auto p-4"
      >
        {turns.length === 0 ? (
          <EmptyState />
        ) : (
          turns.map((turn) => <Turn key={turn.id} turn={turn} />)
        )}
        {pending ? (
          <p className="text-xs text-muted-foreground" aria-live="polite">
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

function EmptyState(): React.JSX.Element {
  return (
    <div className="rounded-lg border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
      <Bot className="mx-auto mb-2 size-5 text-muted-foreground/70" aria-hidden="true" />
      <p className="font-medium text-foreground">How can I help?</p>
      <p className="mt-1 text-xs">
        Try: &ldquo;Summarise my open deals&rdquo; or &ldquo;Draft a follow-up for Ada&rdquo;.
      </p>
    </div>
  )
}

function Turn({ turn }: { turn: ChatTurn }): React.JSX.Element {
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
      <div className="flex max-w-[85%] items-start gap-2">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-foreground"
        >
          <Bot className="size-3.5" />
        </span>
        <div className="rounded-lg rounded-tl-sm bg-muted px-3 py-2 text-sm text-foreground">
          <p className="whitespace-pre-wrap break-words">{turn.content}</p>
        </div>
      </div>
    </div>
  )
}
