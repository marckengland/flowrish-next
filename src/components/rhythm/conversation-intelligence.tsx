'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckSquare,
  Loader2,
  Sparkles,
  Tag,
  Users,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { CoachingComments } from '@/components/rhythm/coaching-comments'

/**
 * Meeting summary payload returned by the conversation intelligence API.
 *
 * Mirrors `MeetingSummary` from the source repo; the structure is what
 * `POST /api/rhythm/conversations/[activityId]/summarize` (task 30.3)
 * returns and what `GET /api/rhythm/conversations/lead/[leadId]` lists.
 */
export interface MeetingSummary {
  id: string
  leadId: string
  type: 'MEETING' | 'CALL'
  createdAt: string
  meetingDate: string | null
  attendees: string[]
  rawNotes: string
  aiSummary: string | null
  keyTopics: string[]
  actionItems: string[]
  sentiment: 'positive' | 'neutral' | 'negative' | null
  trackers: { keyword: string; context: string }[]
}

export interface ConversationIntelligenceProps {
  leadId: string
  /**
   * Whether the current user may post coaching comments in-line on a
   * conversation. Forwarded to the `CoachingComments` thread per
   * Requirement 30.4.
   */
  canCoach: boolean
}

const conversationsKeys = {
  all: ['conversations'] as const,
  byLead: (leadId: string) =>
    [...conversationsKeys.all, 'byLead', leadId] as const,
}

async function fetchLeadConversations(
  leadId: string,
): Promise<MeetingSummary[]> {
  const res = await fetch(`/api/rhythm/conversations/lead/${leadId}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  })
  if (!res.ok) {
    let message = `Failed to load conversations (${res.status})`
    try {
      const body = (await res.json()) as { error?: { message?: string } }
      if (body.error?.message) message = body.error.message
    } catch {
      // ignore
    }
    throw new Error(message)
  }
  const body = (await res.json()) as { data: MeetingSummary[] }
  return body.data
}

async function summarizeMeeting(
  activityId: string,
): Promise<MeetingSummary> {
  const res = await fetch(
    `/api/rhythm/conversations/${activityId}/summarize`,
    {
      method: 'POST',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    },
  )
  if (!res.ok) {
    let message = `Failed to summarize meeting (${res.status})`
    try {
      const body = (await res.json()) as { error?: { message?: string } }
      if (body.error?.message) message = body.error.message
    } catch {
      // ignore
    }
    throw new Error(message)
  }
  const body = (await res.json()) as { data: MeetingSummary }
  return body.data
}

/**
 * Conversation Intelligence panel for a lead.
 *
 * Lists every meeting and call logged against the lead and lets the user
 * request (or re-display) an AI-generated summary per conversation. The
 * summary is persisted on the activity so subsequent visits are idempotent
 * without paying the AI cost (Requirement 31.2 — idempotence).
 *
 * Each conversation surfaces its own `CoachingComments` thread so a
 * manager can coach in-context without leaving the lead page.
 *
 * Validates: Requirements 31.1, 31.2, 31.3, 30.1
 */
export function ConversationIntelligence({
  leadId,
  canCoach,
}: ConversationIntelligenceProps): React.JSX.Element {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: conversationsKeys.byLead(leadId),
    queryFn: () => fetchLeadConversations(leadId),
    enabled: Boolean(leadId),
  })

  const mutation = useMutation({
    mutationFn: (activityId: string) => summarizeMeeting(activityId),
    onSuccess: (summary) => {
      queryClient.setQueryData<MeetingSummary[] | undefined>(
        conversationsKeys.byLead(leadId),
        (prev) => {
          if (!prev) return prev
          return prev.map((c) => (c.id === summary.id ? summary : c))
        },
      )
    },
  })

  if (query.isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        <span>Loading conversations…</span>
      </div>
    )
  }

  if (query.isError) {
    return (
      <p role="alert" className="text-sm text-danger-foreground">
        {query.error instanceof Error
          ? query.error.message
          : 'Couldn’t load conversations.'}
      </p>
    )
  }

  const conversations = query.data ?? []

  if (conversations.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No meetings or calls logged yet. Once a meeting or call is
        captured in the activity timeline it will appear here with an AI
        summary option.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-3">
      {conversations.map((conversation) => (
        <li key={conversation.id}>
          <ConversationCard
            conversation={conversation}
            onSummarize={() => mutation.mutate(conversation.id)}
            summarizing={
              mutation.isPending && mutation.variables === conversation.id
            }
            error={
              mutation.isError && mutation.variables === conversation.id
                ? mutation.error instanceof Error
                  ? mutation.error.message
                  : 'Couldn’t summarize.'
                : null
            }
            canCoach={canCoach}
          />
        </li>
      ))}
    </ul>
  )
}

function ConversationCard({
  conversation,
  onSummarize,
  summarizing,
  error,
  canCoach,
}: {
  conversation: MeetingSummary
  onSummarize: () => void
  summarizing: boolean
  error: string | null
  canCoach: boolean
}): React.JSX.Element {
  const when = conversation.meetingDate ?? conversation.createdAt

  return (
    <article className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">
            {conversation.type === 'MEETING' ? 'Meeting' : 'Call'}
          </h3>
          <p className="text-xs text-muted-foreground">
            {formatTimestamp(when)}
            {conversation.sentiment ? (
              <> · {prettySentiment(conversation.sentiment)}</>
            ) : null}
          </p>
        </div>
        {conversation.attendees.length > 0 ? (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="size-3" aria-hidden="true" />
            {conversation.attendees.join(', ')}
          </p>
        ) : null}
      </header>

      {conversation.aiSummary ? (
        <div className="rounded-lg border border-brand/20 bg-brand-subtle p-3">
          <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-brand-emphasis">
            <Sparkles className="size-3" aria-hidden="true" />
            AI summary
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
            {conversation.aiSummary}
          </p>

          {conversation.keyTopics.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs font-medium">Key topics</p>
              <ul className="mt-1 flex flex-wrap gap-1">
                {conversation.keyTopics.map((topic) => (
                  <li
                    key={topic}
                    className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs"
                  >
                    <Tag className="size-3" aria-hidden="true" />
                    {topic}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {conversation.actionItems.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs font-medium">Action items</p>
              <ul className="mt-1 space-y-1">
                {conversation.actionItems.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-1.5 text-xs"
                  >
                    <CheckSquare
                      className="mt-0.5 size-3 text-brand-emphasis"
                      aria-hidden="true"
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {conversation.trackers.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs font-medium">Tracker matches</p>
              <ul className="mt-1 space-y-1">
                {conversation.trackers.map((tracker, idx) => (
                  <li key={`${tracker.keyword}-${idx}`} className="text-xs">
                    <span className="font-medium">{tracker.keyword}</span>
                    {tracker.context ? (
                      <span className="ml-1 text-muted-foreground">
                        · {tracker.context}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {conversation.rawNotes ? (
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {conversation.rawNotes}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No notes captured yet — add notes to the activity to enable
              AI summarization.
            </p>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onSummarize}
            disabled={summarizing || !conversation.rawNotes}
          >
            {summarizing ? (
              <>
                <Loader2
                  className="size-3 animate-spin"
                  aria-hidden="true"
                />
                <span>Summarizing…</span>
              </>
            ) : (
              <>
                <Sparkles className="size-3" aria-hidden="true" />
                <span>Summarize with AI</span>
              </>
            )}
          </Button>
          {error ? (
            <p role="alert" className="text-xs text-danger-foreground">
              {error}
            </p>
          ) : null}
        </div>
      )}

      <CoachingComments activityId={conversation.id} canComment={canCoach} />
    </article>
  )
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function prettySentiment(sentiment: 'positive' | 'neutral' | 'negative'): string {
  switch (sentiment) {
    case 'positive':
      return 'Positive'
    case 'negative':
      return 'Negative'
    default:
      return 'Neutral'
  }
}
