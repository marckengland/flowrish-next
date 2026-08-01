'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Loader2, MessageSquarePlus, Send } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * Coaching comment payload returned by `GET /api/rhythm/coaching/[activityId]`.
 *
 * Backed by the `CoachingComment` Prisma model. The API is implemented in
 * task 30.3 of the spec; this component is built against that contract so
 * the lead detail page's coaching thread is ready to activate as soon as
 * the backend goes live.
 */
export interface CoachingComment {
  id: string
  activityId: string
  authorId: string
  mentionedUserId: string | null
  content: string
  createdAt: string
  author?: {
    id: string
    name: string
    email: string
  } | null
}

export interface CoachingCommentsProps {
  activityId: string
  /**
   * Whether the current user can author coaching comments (typically
   * MANAGER or higher). Members can still read comments on their own
   * activities (Requirement 30.4) but cannot create them.
   */
  canComment: boolean
}

const coachingKeys = {
  all: ['coaching'] as const,
  byActivity: (activityId: string) =>
    [...coachingKeys.all, 'byActivity', activityId] as const,
}

async function fetchCoachingComments(
  activityId: string,
): Promise<CoachingComment[]> {
  const res = await fetch(`/api/rhythm/coaching/${activityId}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  })
  if (!res.ok) {
    let message = `Failed to load coaching comments (${res.status})`
    try {
      const body = (await res.json()) as { error?: { message?: string } }
      if (body.error?.message) message = body.error.message
    } catch {
      // ignore
    }
    throw new Error(message)
  }
  const body = (await res.json()) as { data: CoachingComment[] }
  return body.data
}

async function postCoachingComment(
  activityId: string,
  content: string,
  mentionedUserId: string | null,
): Promise<CoachingComment> {
  const res = await fetch(`/api/rhythm/coaching/${activityId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    credentials: 'same-origin',
    body: JSON.stringify({ content, mentionedUserId }),
  })
  if (!res.ok) {
    let message = `Failed to add coaching comment (${res.status})`
    try {
      const body = (await res.json()) as { error?: { message?: string } }
      if (body.error?.message) message = body.error.message
    } catch {
      // ignore
    }
    throw new Error(message)
  }
  const body = (await res.json()) as { data: CoachingComment }
  return body.data
}

/**
 * Coaching comment thread attached to a single activity.
 *
 * - Lists comments sorted ascending by `createdAt` (newest at the bottom)
 *   mirroring Requirement 30.2.
 * - Managers see a compact composer below the thread; members see only
 *   the thread (Requirement 30.4 is further enforced server-side).
 * - Empty state stays unobtrusive so the lead timeline remains the
 *   primary surface until a manager actually engages.
 *
 * Validates: Requirements 30.1, 30.2, 30.4
 */
export function CoachingComments({
  activityId,
  canComment,
}: CoachingCommentsProps): React.JSX.Element {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [content, setContent] = useState('')

  const query = useQuery({
    queryKey: coachingKeys.byActivity(activityId),
    queryFn: () => fetchCoachingComments(activityId),
    enabled: open,
  })

  const mutation = useMutation({
    mutationFn: () => postCoachingComment(activityId, content.trim(), null),
    onSuccess: () => {
      setContent('')
      queryClient.invalidateQueries({
        queryKey: coachingKeys.byActivity(activityId),
      })
    },
  })

  const comments = query.data ?? []

  return (
    <section
      aria-label="Coaching comments"
      className="rounded-lg border bg-background/60 p-3"
    >
      <header className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Coaching
        </h4>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={`coaching-thread-${activityId}`}
        >
          {open
            ? 'Hide thread'
            : comments.length > 0
              ? `View thread (${comments.length})`
              : 'View thread'}
        </Button>
      </header>

      {open ? (
        <div
          id={`coaching-thread-${activityId}`}
          className="mt-2 flex flex-col gap-2"
        >
          {query.isLoading ? (
            <p
              role="status"
              aria-live="polite"
              className="flex items-center gap-1 text-xs text-muted-foreground"
            >
              <Loader2 className="size-3 animate-spin" aria-hidden="true" />
              Loading coaching comments…
            </p>
          ) : query.isError ? (
            <p role="alert" className="text-xs text-danger-foreground">
              {query.error instanceof Error
                ? query.error.message
                : 'Couldn’t load coaching comments.'}
            </p>
          ) : comments.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No coaching comments yet.
            </p>
          ) : (
            <ol className="flex flex-col gap-2">
              {comments.map((comment) => (
                <li
                  key={comment.id}
                  className="rounded-lg border bg-card px-3 py-2 text-sm"
                >
                  <header className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-foreground">
                      {comment.author?.name ?? 'Manager'}
                    </span>
                    <time
                      dateTime={comment.createdAt}
                      className="text-muted-foreground"
                    >
                      {formatTimestamp(comment.createdAt)}
                    </time>
                  </header>
                  <p className="mt-1 whitespace-pre-wrap text-sm">
                    {comment.content}
                  </p>
                </li>
              ))}
            </ol>
          )}

          {canComment ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (content.trim() === '') return
                mutation.mutate()
              }}
              className="flex flex-col gap-2"
            >
              <label
                htmlFor={`coaching-content-${activityId}`}
                className="sr-only"
              >
                Coaching comment
              </label>
              <textarea
                id={`coaching-content-${activityId}`}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={2}
                placeholder="Add coaching feedback…"
                className="w-full rounded-[10px] border border-input bg-card px-3 py-1.5 text-sm shadow-sm transition-[color,box-shadow,border-color] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand/15"
              />
              {mutation.isError ? (
                <p role="alert" className="text-xs text-danger-foreground">
                  {mutation.error instanceof Error
                    ? mutation.error.message
                    : 'Couldn’t add comment.'}
                </p>
              ) : null}
              <div className="flex justify-end">
                <Button
                  type="submit"
                  size="xs"
                  disabled={
                    mutation.isPending || content.trim().length === 0
                  }
                >
                  {mutation.isPending ? (
                    <>
                      <Loader2
                        className="size-3 animate-spin"
                        aria-hidden="true"
                      />
                      <span>Saving…</span>
                    </>
                  ) : (
                    <>
                      <Send className="size-3" aria-hidden="true" />
                      <span>Comment</span>
                    </>
                  )}
                </Button>
              </div>
            </form>
          ) : null}
        </div>
      ) : !open && canComment ? (
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <MessageSquarePlus className="size-3" aria-hidden="true" />
          Open the thread to coach on this activity.
        </p>
      ) : null}
    </section>
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
