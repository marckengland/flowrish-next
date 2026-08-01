'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Shape of a cadence schedule as returned by the API. Mirrors the
 * `CadenceScheduleData` type on the server. Times are stored as
 * minutes-from-midnight in the schedule's timezone so daylight-saving
 * doesn't drift the window away from local business hours.
 */
export interface CadenceScheduleValue {
  id: string
  cadenceId: string
  name: string
  daysOfWeek: number[]
  startTimeMinutes: number
  endTimeMinutes: number
  timezone: string
}

interface CadenceScheduleEditorProps {
  cadenceId: string
  /** Current schedule from the server, or null when none exists. */
  initialSchedule: CadenceScheduleValue | null
  /** When false, controls render in read-only mode. */
  canManage: boolean
}

const DAY_LABELS: ReadonlyArray<{ value: number; short: string; long: string }> =
  [
    { value: 1, short: 'Mon', long: 'Monday' },
    { value: 2, short: 'Tue', long: 'Tuesday' },
    { value: 3, short: 'Wed', long: 'Wednesday' },
    { value: 4, short: 'Thu', long: 'Thursday' },
    { value: 5, short: 'Fri', long: 'Friday' },
    { value: 6, short: 'Sat', long: 'Saturday' },
    { value: 0, short: 'Sun', long: 'Sunday' },
  ]

/**
 * A curated list of common IANA timezones. The browser's
 * `Intl.supportedValuesOf('timeZone')` covers the long tail when
 * available — we prepend a frequent-use list so the dropdown lands
 * users on the right zone in two scrolls.
 */
const COMMON_TIMEZONES: ReadonlyArray<string> = [
  'UTC',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Toronto',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Athens',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Pacific/Auckland',
]

function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function hhmmToMinutes(value: string): number {
  const [h = '0', m = '0'] = value.split(':')
  return Number(h) * 60 + Number(m)
}

/**
 * Schedule editor for a single cadence — controls when the runner is
 * allowed to send. Outside the configured days/hours the Inngest
 * function sleeps the enrollment until the next allowed window opens.
 *
 * The form mirrors the original Flowrish schedule UI: a name field,
 * From/To time inputs, a timezone dropdown, and a Monday-first row of
 * day-of-week checkboxes. Saving an empty schedule (clear button)
 * removes the row and the runner reverts to immediate sending.
 *
 * Validates: Requirement 6.10
 */
export function CadenceScheduleEditor({
  cadenceId,
  initialSchedule,
  canManage,
}: CadenceScheduleEditorProps): React.JSX.Element {
  const router = useRouter()
  const browserTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    } catch {
      return 'UTC'
    }
  }, [])

  const [name, setName] = useState(initialSchedule?.name ?? 'Default schedule')
  const [days, setDays] = useState<number[]>(
    initialSchedule?.daysOfWeek ?? [1, 2, 3, 4, 5],
  )
  const [startTime, setStartTime] = useState(
    minutesToHHMM(initialSchedule?.startTimeMinutes ?? 540),
  )
  const [endTime, setEndTime] = useState(
    minutesToHHMM(initialSchedule?.endTimeMinutes ?? 1020),
  )
  const [timezone, setTimezone] = useState(
    initialSchedule?.timezone ?? browserTz,
  )
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Reset form to whatever the server sent if the underlying record
  // changes (e.g. after a successful save the page refreshes).
  useEffect(() => {
    setName(initialSchedule?.name ?? 'Default schedule')
    setDays(initialSchedule?.daysOfWeek ?? [1, 2, 3, 4, 5])
    setStartTime(minutesToHHMM(initialSchedule?.startTimeMinutes ?? 540))
    setEndTime(minutesToHHMM(initialSchedule?.endTimeMinutes ?? 1020))
    setTimezone(initialSchedule?.timezone ?? browserTz)
  }, [initialSchedule, browserTz])

  const allTimezones = useMemo(() => {
    const set = new Set<string>(COMMON_TIMEZONES)
    set.add(browserTz)
    if (initialSchedule?.timezone) set.add(initialSchedule.timezone)
    // `Intl.supportedValuesOf` is only available in newer runtimes —
    // guard so the dropdown still works in older browsers.
    const intlAny = Intl as unknown as {
      supportedValuesOf?: (key: string) => string[]
    }
    if (typeof intlAny.supportedValuesOf === 'function') {
      try {
        for (const tz of intlAny.supportedValuesOf('timeZone')) set.add(tz)
      } catch {
        // ignore — fallback list is fine
      }
    }
    return Array.from(set).sort()
  }, [browserTz, initialSchedule])

  function toggleDay(day: number) {
    setDays((prev) =>
      prev.includes(day)
        ? prev.filter((d) => d !== day)
        : [...prev, day].sort((a, b) => a - b),
    )
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    if (days.length === 0) {
      setError('Pick at least one day for the cadence to send.')
      return
    }
    const startMinutes = hhmmToMinutes(startTime)
    const endMinutes = hhmmToMinutes(endTime)
    if (startMinutes >= endMinutes) {
      setError('"From" time must be earlier than the "To" time.')
      return
    }

    startTransition(async () => {
      const res = await fetch(`/api/cadences/${cadenceId}/schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          name,
          daysOfWeek: days,
          startTimeMinutes: startMinutes,
          endTimeMinutes: endMinutes,
          timezone,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setError(body.error?.message ?? `Failed to save (${res.status})`)
        return
      }
      setSuccess('Schedule saved.')
      router.refresh()
    })
  }

  function clear() {
    if (!initialSchedule) return
    if (
      !confirm(
        'Remove this schedule? Steps will fire immediately as they queue, with no time-of-day gating.',
      )
    ) {
      return
    }
    setError(null)
    setSuccess(null)

    startTransition(async () => {
      const res = await fetch(`/api/cadences/${cadenceId}/schedule`, {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setError(body.error?.message ?? `Failed to remove (${res.status})`)
        return
      }
      setSuccess('Schedule removed — steps will fire immediately.')
      router.refresh()
    })
  }

  const isReadOnly = !canManage

  return (
    <form
      onSubmit={save}
      aria-label="Cadence sending schedule"
      className="flex flex-col gap-5 rounded-md border bg-card p-5"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">Sending schedule</h2>
        <p className="text-sm text-muted-foreground">
          Limit when this cadence is allowed to send. Outside the window the
          runner waits until the next allowed slot, so emails and tasks
          don&apos;t fire at odd hours.
        </p>
      </header>

      {/* Name */}
      <div className="flex flex-col gap-1">
        <label
          htmlFor="schedule-name"
          className="text-xs font-medium text-foreground"
        >
          Name
        </label>
        <input
          id="schedule-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          disabled={isReadOnly || pending}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          placeholder="e.g. US business hours"
        />
      </div>

      {/* From / To times */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label
            htmlFor="schedule-start"
            className="text-xs font-medium text-foreground"
          >
            From
          </label>
          <input
            id="schedule-start"
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            disabled={isReadOnly || pending}
            step={60 * 15}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor="schedule-end"
            className="text-xs font-medium text-foreground"
          >
            To
          </label>
          <input
            id="schedule-end"
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            disabled={isReadOnly || pending}
            step={60 * 15}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          />
        </div>
      </div>

      {/* Timezone */}
      <div className="flex flex-col gap-1">
        <label
          htmlFor="schedule-tz"
          className="text-xs font-medium text-foreground"
        >
          Timezone
        </label>
        <select
          id="schedule-tz"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          disabled={isReadOnly || pending}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          {allTimezones.map((tz) => (
            <option key={tz} value={tz}>
              {tz === browserTz ? `${tz} (your computer)` : tz}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-muted-foreground">
          Times above are interpreted in this timezone.
        </p>
      </div>

      {/* Days of week */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-medium text-foreground">
          Send on these days
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {DAY_LABELS.map((d) => {
            const checked = days.includes(d.value)
            return (
              <label
                key={d.value}
                className={cn(
                  'flex cursor-pointer select-none items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                  checked
                    ? 'border-brand bg-brand text-brand-foreground'
                    : 'border-input bg-background text-foreground hover:bg-muted',
                  (isReadOnly || pending) && 'cursor-not-allowed opacity-60',
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleDay(d.value)}
                  disabled={isReadOnly || pending}
                  className="sr-only"
                />
                <span className="sm:hidden">{d.short}</span>
                <span className="hidden sm:inline">{d.long}</span>
              </label>
            )
          })}
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {success && (
        <p
          role="status"
          className="rounded-[10px] border border-brand/30 bg-brand-subtle px-3 py-2 text-sm text-brand-emphasis"
        >
          {success}
        </p>
      )}

      {!isReadOnly && (
        <div className="flex items-center justify-between gap-2 pt-1">
          {initialSchedule ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={clear}
              disabled={pending}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              <span>Remove schedule</span>
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              No schedule yet — steps will fire immediately as they queue.
            </p>
          )}
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                <span>Saving…</span>
              </>
            ) : (
              <span>Save schedule</span>
            )}
          </Button>
        </div>
      )}
    </form>
  )
}
