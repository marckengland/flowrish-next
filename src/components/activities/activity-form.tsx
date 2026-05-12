'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useCreateActivityMutation } from '@/hooks/use-activities'

/**
 * Activity types exposed in the logger dropdown. FILE_ATTACHMENT is
 * omitted here because it is created indirectly by the upload flow
 * (task 17 in the spec), not by typing into a text box.
 */
const ACTIVITY_TYPE_OPTIONS: ReadonlyArray<{
  value: 'NOTE' | 'CALL' | 'MEETING' | 'EMAIL'
  label: string
}> = [
  { value: 'NOTE', label: 'Note' },
  { value: 'CALL', label: 'Call' },
  { value: 'MEETING', label: 'Meeting' },
  { value: 'EMAIL', label: 'Email' },
]

export interface ActivityFormProps {
  leadId: string
  /** Optional callback fired after a successful activity creation. */
  onCreated?: (activityId: string) => void
}

type ActivityType = (typeof ACTIVITY_TYPE_OPTIONS)[number]['value']

/**
 * Log-new-activity form rendered inside the lead detail page.
 *
 * - Uses the TanStack mutation so the timeline invalidates automatically.
 * - Only the type-relevant fields are shown for each activity type
 *   (e.g. callDate/callDuration only for CALL) matching the validator
 *   contract (`activityCreateSchema`).
 * - Surfaces the server error message returned from `POST /api/activities`
 *   so Zod-side validation issues reach the user verbatim.
 *
 * Validates: Requirements 5.1, 5.2, 5.3
 */
export function ActivityForm({
  leadId,
  onCreated,
}: ActivityFormProps): React.JSX.Element {
  const [type, setType] = useState<ActivityType>('NOTE')
  const [notes, setNotes] = useState('')
  const [callDate, setCallDate] = useState('')
  const [callDuration, setCallDuration] = useState('')
  const [meetingDate, setMeetingDate] = useState('')
  const [attendees, setAttendees] = useState('')

  const mutation = useCreateActivityMutation()

  function reset(): void {
    setNotes('')
    setCallDate('')
    setCallDuration('')
    setMeetingDate('')
    setAttendees('')
  }

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault()
    const payload = {
      leadId,
      type,
      notes: notes.trim() === '' ? null : notes,
      callDate: type === 'CALL' && callDate ? new Date(callDate).toISOString() : null,
      callDuration:
        type === 'CALL' && callDuration !== '' ? Number(callDuration) : null,
      meetingDate:
        type === 'MEETING' && meetingDate
          ? new Date(meetingDate).toISOString()
          : null,
      attendees:
        type === 'MEETING' && attendees.trim() !== ''
          ? attendees
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : null,
    }

    try {
      const created = await mutation.mutateAsync(payload)
      onCreated?.(created.id)
      reset()
    } catch {
      // The mutation exposes `error` below; no further action needed.
    }
  }

  const pending = mutation.isPending

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-md border bg-card p-4"
      aria-busy={pending || undefined}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[160px]">
          <label
            htmlFor="activity-type"
            className="block text-xs font-medium text-foreground mb-1"
          >
            Activity type
          </label>
          <select
            id="activity-type"
            value={type}
            onChange={(e) => setType(e.target.value as ActivityType)}
            className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {ACTIVITY_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {type === 'CALL' && (
          <>
            <div className="min-w-[200px]">
              <label
                htmlFor="activity-call-date"
                className="block text-xs font-medium text-foreground mb-1"
              >
                Call date & time
              </label>
              <input
                id="activity-call-date"
                type="datetime-local"
                value={callDate}
                onChange={(e) => setCallDate(e.target.value)}
                required
                className={inputClass}
              />
            </div>
            <div className="min-w-[140px]">
              <label
                htmlFor="activity-call-duration"
                className="block text-xs font-medium text-foreground mb-1"
              >
                Duration (seconds)
              </label>
              <input
                id="activity-call-duration"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={callDuration}
                onChange={(e) => setCallDuration(e.target.value)}
                placeholder="e.g. 300"
                className={inputClass}
              />
            </div>
          </>
        )}

        {type === 'MEETING' && (
          <>
            <div className="min-w-[200px]">
              <label
                htmlFor="activity-meeting-date"
                className="block text-xs font-medium text-foreground mb-1"
              >
                Meeting date & time
              </label>
              <input
                id="activity-meeting-date"
                type="datetime-local"
                value={meetingDate}
                onChange={(e) => setMeetingDate(e.target.value)}
                required
                className={inputClass}
              />
            </div>
            <div className="min-w-[220px] flex-1">
              <label
                htmlFor="activity-attendees"
                className="block text-xs font-medium text-foreground mb-1"
              >
                Attendees (comma separated)
              </label>
              <input
                id="activity-attendees"
                type="text"
                value={attendees}
                onChange={(e) => setAttendees(e.target.value)}
                placeholder="Jane Doe, John Smith"
                className={inputClass}
              />
            </div>
          </>
        )}
      </div>

      <div>
        <label
          htmlFor="activity-notes"
          className="block text-xs font-medium text-foreground mb-1"
        >
          Notes
        </label>
        <textarea
          id="activity-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder={placeholderForType(type)}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {mutation.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {mutation.error instanceof Error
            ? mutation.error.message
            : 'Failed to log activity.'}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button type="submit" disabled={pending} size="sm">
          {pending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              <span>Logging…</span>
            </>
          ) : (
            <span>Log activity</span>
          )}
        </Button>
      </div>
    </form>
  )
}

const inputClass = cn(
  'flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
)

function placeholderForType(type: ActivityType): string {
  switch (type) {
    case 'CALL':
      return 'Summary of the call, outcomes, next steps…'
    case 'MEETING':
      return 'Agenda, key topics, action items…'
    case 'EMAIL':
      return 'Describe the email exchange or paste a summary…'
    case 'NOTE':
    default:
      return 'Add a note about this lead…'
  }
}
