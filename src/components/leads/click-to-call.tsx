'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Phone } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useCreateActivityMutation } from '@/hooks/use-activities'

export interface ClickToCallProps {
  leadId: string
  /** Lead's phone number, or null when none is on file. */
  phone: string | null
  leadName: string
  /** Whether the current user may log the call as an activity. */
  canLog: boolean
}

const OUTCOMES = [
  'Connected',
  'Left voicemail',
  'No answer',
  'Busy',
  'Wrong number',
] as const

type Outcome = (typeof OUTCOMES)[number]

/**
 * Click-to-call for the lead detail.
 *
 * Uses a plain `tel:` link so the call is placed by the rep's device
 * dialer or default softphone — no paid telephony provider required, so
 * there's zero per-minute cost. While the call is in progress an on-screen
 * timer runs, and the rep logs the outcome + duration as a CALL activity
 * (reusing the existing activities pipeline / timeline).
 *
 * The `tel:` action is deliberately provider-agnostic: swapping in an
 * in-browser WebRTC dialer later (Telnyx / SignalWire / Twilio Voice SDK)
 * only means replacing `placeCall` — the logging UI stays the same.
 */
export function ClickToCall({
  leadId,
  phone,
  leadName,
  canLog,
}: ClickToCallProps): React.JSX.Element {
  const [inCall, setInCall] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [durationEdited, setDurationEdited] = useState(false)
  const [durationSeconds, setDurationSeconds] = useState(0)
  const [outcome, setOutcome] = useState<Outcome>('Connected')
  const [notes, setNotes] = useState('')
  const [logged, setLogged] = useState(false)
  const intervalRef = useRef<number | null>(null)

  const mutation = useCreateActivityMutation()

  useEffect(() => {
    if (startedAt == null) return
    intervalRef.current = window.setInterval(() => {
      const secs = Math.floor((Date.now() - startedAt) / 1000)
      setElapsed(secs)
      setDurationSeconds((prev) => (durationEdited ? prev : secs))
    }, 1000)
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current)
    }
  }, [startedAt, durationEdited])

  function placeCall(): void {
    // The <a href="tel:"> handles the actual dial-out; here we just start
    // the timer + reveal the logging panel.
    setLogged(false)
    setInCall(true)
    setDurationEdited(false)
    setDurationSeconds(0)
    setElapsed(0)
    setStartedAt(Date.now())
  }

  async function logCall(): Promise<void> {
    const composedNotes = notes.trim()
      ? `${outcome} — ${notes.trim()}`
      : outcome
    try {
      await mutation.mutateAsync({
        leadId,
        type: 'CALL',
        callDate: new Date(startedAt ?? Date.now()).toISOString(),
        callDuration: Math.max(0, Math.round(durationSeconds)),
        notes: composedNotes,
      })
      setLogged(true)
      setInCall(false)
      setStartedAt(null)
      setNotes('')
      setDurationEdited(false)
    } catch {
      // mutation.error is surfaced below
    }
  }

  function cancel(): void {
    setInCall(false)
    setStartedAt(null)
    setNotes('')
    setDurationEdited(false)
  }

  if (!phone) {
    return (
      <p className="text-sm text-muted-foreground">
        No phone number on file. Add one to enable click-to-call.
      </p>
    )
  }

  const telHref = `tel:${phone.replace(/[^\d+]/g, '')}`

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[13px] text-foreground">{phone}</span>
        <Button
          nativeButton={false}
          render={<a href={telHref} />}
          onClick={placeCall}
          size="sm"
          aria-label={`Call ${leadName}`}
        >
          <Phone className="size-4" aria-hidden="true" />
          <span>Call</span>
        </Button>
      </div>

      {inCall && canLog && (
        <div className="flex flex-col gap-2.5 rounded-[10px] border bg-background/60 p-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-[13px] font-medium text-foreground">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand/60" />
                <span className="relative inline-flex size-2 rounded-full bg-brand" />
              </span>
              In call
            </span>
            <span className="tnum font-mono text-[13px] text-muted-foreground">
              {formatDuration(elapsed)}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label
                htmlFor="call-outcome"
                className="mb-1 block text-xs font-medium text-foreground"
              >
                Outcome
              </label>
              <select
                id="call-outcome"
                value={outcome}
                onChange={(e) => setOutcome(e.target.value as Outcome)}
                className={selectClass}
              >
                {OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="call-duration"
                className="mb-1 block text-xs font-medium text-foreground"
              >
                Duration (sec)
              </label>
              <input
                id="call-duration"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={durationSeconds}
                onChange={(e) => {
                  setDurationEdited(true)
                  setDurationSeconds(Number(e.target.value) || 0)
                }}
                className={selectClass}
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="call-notes"
              className="mb-1 block text-xs font-medium text-foreground"
            >
              Notes
            </label>
            <textarea
              id="call-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="What happened on the call, next steps…"
              className="w-full rounded-[10px] border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm transition-[color,box-shadow,border-color] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand/15"
            />
          </div>

          {mutation.isError && (
            <p role="alert" className="text-xs text-destructive">
              {mutation.error instanceof Error
                ? mutation.error.message
                : 'Failed to log the call.'}
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={cancel}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={logCall}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  <span>Logging…</span>
                </>
              ) : (
                <span>End & log call</span>
              )}
            </Button>
          </div>
        </div>
      )}

      {logged && (
        <p className="text-xs text-brand-emphasis">
          Call logged to the activity timeline.
        </p>
      )}
    </div>
  )
}

const selectClass = cn(
  'h-9 w-full rounded-[10px] border border-input bg-card px-2.5 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow,border-color] focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand/15',
)

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
