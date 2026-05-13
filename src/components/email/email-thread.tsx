'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, Mail, Reply } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Shape of an email message within a thread. Matches the EmailMessage
 * model fields returned by the API (dates serialized as ISO strings).
 */
export interface EmailThreadMessage {
  id: string
  externalId: string
  threadId: string
  fromEmail: string
  toEmail: string
  subject: string
  bodyPreview: string
  sentAt: string
  /** Whether this message was sent by the current user (outbound). */
  isOutbound: boolean
}

export interface EmailThreadProps {
  /** Thread ID grouping these messages. */
  threadId: string
  /** Messages in the thread, sorted by sentAt ascending (oldest first). */
  messages: readonly EmailThreadMessage[]
  /** Called when the user clicks "Reply" on the latest message. */
  onReply?: (threadId: string, lastMessage: EmailThreadMessage) => void
  /** Optional extra class for the root element. */
  className?: string
}

/**
 * Threaded email view — displays a conversation thread grouped by threadId.
 *
 * Shows the most recent message expanded by default, with older messages
 * collapsed behind a "Show N earlier messages" toggle. Each message shows
 * sender, recipient, timestamp, and body preview.
 *
 * The "Reply" button at the bottom triggers the parent to open the compose
 * form pre-filled with the thread context.
 *
 * Validates: Requirements 7.3, 7.4
 */
export function EmailThread({
  threadId,
  messages,
  onReply,
  className,
}: EmailThreadProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)

  if (messages.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col items-center gap-2 rounded-md border border-dashed bg-card px-4 py-6 text-sm',
          className,
        )}
      >
        <Mail className="size-5 text-muted-foreground" aria-hidden="true" />
        <p className="text-muted-foreground">No messages in this thread.</p>
      </div>
    )
  }

  // Sort messages oldest-first for display
  const sorted = [...messages].sort(
    (a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime(),
  )

  const latestMessage = sorted[sorted.length - 1]
  const olderMessages = sorted.slice(0, -1)
  const hasOlderMessages = olderMessages.length > 0

  return (
    <section
      aria-label={`Email thread: ${latestMessage.subject}`}
      className={cn('flex flex-col gap-2', className)}
    >
      {/* Thread subject header */}
      <header className="flex items-center gap-2">
        <Mail className="size-4 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-foreground">
          {latestMessage.subject}
        </h3>
        <span className="text-xs text-muted-foreground">
          ({messages.length} message{messages.length === 1 ? '' : 's'})
        </span>
      </header>

      {/* Collapsed older messages toggle */}
      {hasOlderMessages && (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="flex items-center gap-1 self-start rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-expanded={expanded}
          aria-controls={`thread-${threadId}-older`}
        >
          {expanded ? (
            <ChevronUp className="size-3" aria-hidden="true" />
          ) : (
            <ChevronDown className="size-3" aria-hidden="true" />
          )}
          <span>
            {expanded
              ? 'Hide earlier messages'
              : `Show ${olderMessages.length} earlier message${olderMessages.length === 1 ? '' : 's'}`}
          </span>
        </button>
      )}

      {/* Older messages (collapsed by default) */}
      {hasOlderMessages && expanded && (
        <div
          id={`thread-${threadId}-older`}
          className="flex flex-col gap-2"
        >
          {olderMessages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
        </div>
      )}

      {/* Latest message (always visible) */}
      <MessageBubble message={latestMessage} isLatest />

      {/* Reply action */}
      {onReply && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onReply(threadId, latestMessage)}
          >
            <Reply className="size-3.5" aria-hidden="true" />
            <span>Reply</span>
          </Button>
        </div>
      )}
    </section>
  )
}

interface MessageBubbleProps {
  message: EmailThreadMessage
  isLatest?: boolean
}

function MessageBubble({
  message,
  isLatest = false,
}: MessageBubbleProps): React.JSX.Element {
  return (
    <article
      className={cn(
        'rounded-md border p-3',
        message.isOutbound
          ? 'ml-4 border-primary/20 bg-primary/5'
          : 'mr-4 border-border bg-card',
        isLatest && 'ring-1 ring-ring/20',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs">
          <span className="font-medium text-foreground">
            {message.isOutbound ? 'You' : message.fromEmail}
          </span>
          <span className="text-muted-foreground">→</span>
          <span className="text-muted-foreground">
            {message.isOutbound ? message.toEmail : 'You'}
          </span>
        </div>
        <time
          dateTime={message.sentAt}
          className="shrink-0 text-xs text-muted-foreground"
        >
          {formatMessageDate(message.sentAt)}
        </time>
      </div>
      <p className="mt-2 text-sm text-foreground whitespace-pre-wrap">
        {message.bodyPreview}
      </p>
    </article>
  )
}

/**
 * Formats a message date for display. Shows time for today's messages,
 * short date + time for older messages.
 */
function formatMessageDate(isoDate: string): string {
  const date = new Date(isoDate)
  const now = new Date()
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()

  if (isToday) {
    return date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
