'use client'

import {
  FileText,
  Mail,
  Paperclip,
  Phone,
  Users,
  Loader2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  useLeadActivitiesQuery,
  parseAttendees,
  type ActivityItem,
} from '@/hooks/use-activities'

export interface ActivityTimelineProps {
  leadId: string
  /**
   * Pre-loaded activities from the Server Component so the timeline paints
   * immediately. TanStack Query adopts this as the initial cache value and
   * will invalidate on new activity creation.
   */
  initialActivities?: ActivityItem[]
}

/**
 * Chronological activity list for a lead (newest first).
 *
 * - Subscribes to the activities TanStack Query cache for the lead so the
 *   list refreshes automatically when `useCreateActivityMutation` runs.
 * - Each row is rendered with a type-specific icon and any type-relevant
 *   metadata (call duration, meeting attendees, etc.).
 *
 * Validates: Requirements 5.1, 5.2, 5.4
 */
export function ActivityTimeline({
  leadId,
  initialActivities,
}: ActivityTimelineProps): React.JSX.Element {
  const query = useLeadActivitiesQuery(leadId, initialActivities)

  const activities = query.data ?? initialActivities ?? []

  if (query.isLoading && activities.length === 0) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 rounded-lg border bg-card p-4 text-sm text-muted-foreground"
      >
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        <span>Loading activities…</span>
      </div>
    )
  }

  if (query.isError) {
    return (
      <div role="alert" className="rounded-lg border bg-card p-4 text-sm text-destructive">
        Couldn&apos;t load activities.{' '}
        {query.error instanceof Error ? query.error.message : ''}
      </div>
    )
  }

  if (activities.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        No activities yet. Log a note, call, meeting, or email to start
        building this lead&apos;s history.
      </div>
    )
  }

  return (
    <ol
      aria-label="Activity timeline"
      className="flex flex-col gap-3"
    >
      {activities.map((activity) => (
        <li key={activity.id}>
          <ActivityRow activity={activity} />
        </li>
      ))}
    </ol>
  )
}

function ActivityRow({
  activity,
}: {
  activity: ActivityItem
}): React.JSX.Element {
  const { Icon, label, accent } = typeMeta(activity.type)

  return (
    <article className="flex gap-3 rounded-lg border bg-card p-3.5">
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 flex size-[30px] shrink-0 items-center justify-center rounded-full',
          accent,
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium text-foreground">
            {label}
            <span className="sr-only">{' '}— activity</span>
          </h3>
          <time
            dateTime={activity.createdAt}
            className="text-xs text-muted-foreground"
          >
            {formatDateTime(activity.createdAt)}
          </time>
        </header>

        {renderMeta(activity)}

        {activity.notes ? (
          <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
            {activity.notes}
          </p>
        ) : null}
      </div>
    </article>
  )
}

function renderMeta(activity: ActivityItem): React.JSX.Element | null {
  if (activity.type === 'CALL' && (activity.callDate || activity.callDuration != null)) {
    const pieces: string[] = []
    if (activity.callDate) pieces.push(formatDateTime(activity.callDate))
    if (activity.callDuration != null) {
      pieces.push(formatDuration(activity.callDuration))
    }
    return (
      <p className="mt-0.5 text-xs text-muted-foreground">
        {pieces.join(' · ')}
      </p>
    )
  }

  if (activity.type === 'MEETING') {
    const attendees = parseAttendees(activity.attendees)
    return (
      <p className="mt-0.5 text-xs text-muted-foreground">
        {activity.meetingDate ? formatDateTime(activity.meetingDate) : null}
        {activity.meetingDate && attendees.length > 0 ? ' · ' : null}
        {attendees.length > 0 ? `Attendees: ${attendees.join(', ')}` : null}
      </p>
    )
  }

  return null
}

function typeMeta(type: ActivityItem['type']): {
  Icon: LucideIcon
  label: string
  accent: string
} {
  switch (type) {
    case 'CALL':
      return {
        Icon: Phone,
        label: 'Call',
        accent: 'bg-muted text-foreground/70',
      }
    case 'MEETING':
      return {
        Icon: Users,
        label: 'Meeting',
        accent: 'bg-ai-subtle text-ai',
      }
    case 'EMAIL':
      return {
        Icon: Mail,
        label: 'Email',
        accent: 'bg-brand-subtle text-brand-emphasis',
      }
    case 'FILE_ATTACHMENT':
      return {
        Icon: Paperclip,
        label: 'File attachment',
        accent: 'bg-muted text-foreground/70',
      }
    case 'NOTE':
    default:
      return {
        Icon: FileText,
        label: 'Note',
        accent: 'bg-brand-subtle text-brand-emphasis',
      }
  }
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`
}
