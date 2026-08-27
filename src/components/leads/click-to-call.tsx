'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Ban,
  Loader2,
  Pencil,
  Phone,
  PhoneCall,
  PhoneMissed,
  PhoneOff,
  Voicemail,
  type LucideIcon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useCreateActivityMutation } from '@/hooks/use-activities'
import { useTwilioDialer } from '@/hooks/use-twilio-dialer'

export interface ClickToCallProps {
  leadId: string
  /** Lead's phone number, or null when none is on file. */
  phone: string | null
  leadName: string
  /** Whether the current user may log the call as an activity. */
  canLog: boolean
  /** Org's selected voice provider; enables in-browser calling for 'twilio'. */
  voiceProvider?: string | null
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
 * Visual config per outcome: an icon plus the semantic tone applied when
 * the chip is selected. Icons keep a subtle tone tint even when unselected
 * so the choices read as "call results" at a glance rather than a flat list.
 */
const OUTCOME_CONFIG: Record<
  Outcome,
  { icon: LucideIcon; iconClass: string; selectedClass: string }
> = {
  Connected: {
    icon: PhoneCall,
    iconClass: 'text-brand',
    selectedClass: 'border-brand/50 bg-brand-subtle text-brand-emphasis',
  },
  'Left voicemail': {
    icon: Voicemail,
    iconClass: 'text-muted-foreground',
    selectedClass: 'border-foreground/25 bg-muted text-foreground',
  },
  'No answer': {
    icon: PhoneMissed,
    iconClass: 'text-warning-foreground',
    selectedClass: 'border-warning/50 bg-warning-subtle text-warning-foreground',
  },
  Busy: {
    icon: PhoneOff,
    iconClass: 'text-warning-foreground',
    selectedClass: 'border-warning/50 bg-warning-subtle text-warning-foreground',
  },
  'Wrong number': {
    icon: Ban,
    iconClass: 'text-danger-foreground',
    selectedClass: 'border-danger/50 bg-danger-subtle text-danger-foreground',
  },
}

/**
 * Click-to-call for the lead detail.
 *
 * Two calling modes, chosen automatically:
 *   1. In-browser (Twilio Voice SDK) when the org selected Twilio AND the
 *      server has Twilio configured — placed + hung up right in the app.
 *   2. Free `tel:` fallback otherwise — launches the rep's device dialer /
 *      softphone with zero per-minute cost.
 *
 * Either way a live timer runs and the rep logs the outcome + duration as
 * a CALL activity through the existing activities pipeline.
 */
export function ClickToCall({
  leadId,
  phone,
  leadName,
  canLog,
  voiceProvider,
}: ClickToCallProps): React.JSX.Element {
  const [inCall, setInCall] = useState(false)
  const [twilioActive, setTwilioActive] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [durationEdited, setDurationEdited] = useState(false)
  const [durationSeconds, setDurationSeconds] = useState(0)
  const [editingDuration, setEditingDuration] = useState(false)
  const [outcome, setOutcome] = useState<Outcome>('Connected')
  const [notes, setNotes] = useState('')
  const [logged, setLogged] = useState(false)
  const [starting, setStarting] = useState(false)
  const intervalRef = useRef<number | null>(null)

  const mutation = useCreateActivityMutation()
  const dialer = useTwilioDialer()

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

  // When a Twilio call ends (remote hangup / error), freeze the timer but
  // keep the logging panel open so the rep can save the outcome.
  useEffect(() => {
    if (twilioActive && (dialer.status === 'ended' || dialer.status === 'error')) {
      setStartedAt(null)
    }
  }, [twilioActive, dialer.status])

  function beginTimer(): void {
    setLogged(false)
    setInCall(true)
    setDurationEdited(false)
    setDurationSeconds(0)
    setEditingDuration(false)
    setElapsed(0)
    setStartedAt(Date.now())
  }

  async function placeCall(): Promise<void> {
    if (!phone) return
    setLogged(false)

    if (voiceProvider === 'twilio') {
      setStarting(true)
      const result = await dialer.start(phone)
      setStarting(false)
      if (result === 'connected') {
        setTwilioActive(true)
        beginTimer()
        return
      }
      // Twilio not available → fall through to tel:
    }

    setTwilioActive(false)
    // `tel:` launches the device dialer without navigating away from the page.
    window.location.href = `tel:${phone.replace(/[^\d+]/g, '')}`
    beginTimer()
  }

  async function logCall(): Promise<void> {
    if (twilioActive) dialer.hangup()
    setStartedAt(null)
    const composedNotes = notes.trim() ? `${outcome} — ${notes.trim()}` : outcome
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
      setTwilioActive(false)
      setStartedAt(null)
      setNotes('')
      setDurationEdited(false)
      setEditingDuration(false)
      dialer.reset()
    } catch {
      // mutation.error surfaced below
    }
  }

  function cancel(): void {
    if (twilioActive) dialer.hangup()
    setInCall(false)
    setTwilioActive(false)
    setStartedAt(null)
    setNotes('')
    setDurationEdited(false)
    setEditingDuration(false)
    dialer.reset()
  }

  if (!phone) {
    return (
      <p className="text-sm text-muted-foreground">
        No phone number on file. Add one to enable click-to-call.
      </p>
    )
  }

  const isLive = startedAt != null
  const twilioStatusLabel =
    dialer.status === 'connecting'
      ? 'Connecting…'
      : dialer.status === 'in-call'
        ? 'In call'
        : dialer.status === 'ended'
          ? 'Call ended'
          : dialer.status === 'error'
            ? 'Call error'
            : 'In call'
  const statusLabel = twilioActive
    ? twilioStatusLabel
    : isLive
      ? 'Call in progress'
      : 'Call ended'

  return (
    <div className="flex flex-col gap-3">
      {/* Idle: who + number on the left, the marquee Call action on the right. */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={leadName} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] font-medium text-foreground">
              {leadName}
            </span>
            <span className="truncate font-mono text-xs text-muted-foreground">
              {phone}
            </span>
          </div>
        </div>
        <Button
          type="button"
          onClick={placeCall}
          disabled={starting || dialer.status === 'connecting'}
          aria-label={`Call ${leadName}`}
        >
          {starting || dialer.status === 'connecting' ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Phone className="size-4" aria-hidden="true" />
          )}
          <span>Call</span>
        </Button>
      </div>

      {voiceProvider === 'twilio' && !inCall && (
        <p className="text-[11.5px] text-muted-foreground">
          In-browser calling via Twilio (falls back to your device dialer if
          unavailable).
        </p>
      )}

      {inCall && canLog && (
        <div className="flex flex-col gap-3 duration-200 animate-in fade-in slide-in-from-top-1 motion-reduce:animate-none">
          {/* Live call card — the timer is the focal point; the whole card
              warms to the brand tint while the call is actually running. */}
          <div
            className={cn(
              'flex items-center gap-3 rounded-xl border p-3 transition-colors',
              isLive
                ? 'border-brand/30 bg-brand-subtle'
                : 'border-border bg-muted/40',
            )}
          >
            <div className="relative shrink-0">
              {isLive && (
                <span
                  aria-hidden="true"
                  className="absolute inset-0 rounded-full bg-brand/30 motion-safe:animate-ping"
                />
              )}
              <Avatar name={leadName} live={isLive} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <span
                  className={cn(
                    'inline-block size-1.5 rounded-full',
                    isLive ? 'bg-brand' : 'bg-muted-foreground',
                  )}
                />
                {statusLabel}
              </span>
              <span
                className={cn(
                  'tnum font-mono text-3xl font-semibold leading-tight tracking-tight',
                  isLive ? 'text-brand-emphasis' : 'text-foreground',
                )}
                aria-live="off"
              >
                {formatDuration(elapsed)}
              </span>
            </div>
            {twilioActive && dialer.status === 'in-call' && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => dialer.hangup()}
                className="shrink-0"
              >
                <PhoneOff className="size-4" aria-hidden="true" />
                End call
              </Button>
            )}
          </div>

          {/* Outcome — a segmented chip row instead of a native dropdown. */}
          <div>
            <span className="mb-1.5 block text-xs font-medium text-foreground">
              Outcome
            </span>
            <div
              role="radiogroup"
              aria-label="Call outcome"
              className="flex flex-wrap gap-1.5"
            >
              {OUTCOMES.map((o, i) => {
                const { icon: Icon, iconClass, selectedClass } =
                  OUTCOME_CONFIG[o]
                const selected = outcome === o
                return (
                  <button
                    key={o}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setOutcome(o)}
                    onKeyDown={(e) => handleChipKeydown(e, i, setOutcome)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-brand/25',
                      selected
                        ? selectedClass
                        : 'border-input bg-card text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon
                      className={cn('size-3.5', selected ? '' : iconClass)}
                      aria-hidden="true"
                    />
                    {o}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Duration — reads as mm:ss; editable behind an explicit affordance
              so reps aren't typing raw seconds into a naked number field. */}
          <div>
            <span className="mb-1.5 block text-xs font-medium text-foreground">
              Duration
            </span>
            {editingDuration ? (
              <DurationEditor
                seconds={durationSeconds}
                onChange={(secs) => {
                  setDurationEdited(true)
                  setDurationSeconds(secs)
                }}
                onDone={() => setEditingDuration(false)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingDuration(true)}
                className="inline-flex items-center gap-1.5 rounded-[10px] border border-input bg-card px-2.5 py-1.5 text-sm text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:border-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/15"
              >
                <span className="tnum font-mono">
                  {formatDuration(durationSeconds)}
                </span>
                <Pencil className="size-3 text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">Edit duration</span>
              </button>
            )}
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

          {(mutation.isError || dialer.error) && (
            <p role="alert" className="text-xs text-danger-foreground">
              {dialer.error ??
                (mutation.error instanceof Error
                  ? mutation.error.message
                  : 'Failed to log the call.')}
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
                <span>End &amp; log call</span>
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

/**
 * Roving-tabindex keyboard support for the outcome radiogroup: arrow keys
 * move (and select) the adjacent chip, wrapping at the ends, and focus the
 * newly selected control so the group behaves like a native radio set.
 */
function handleChipKeydown(
  e: React.KeyboardEvent<HTMLButtonElement>,
  index: number,
  setOutcome: (o: Outcome) => void,
): void {
  let next = index
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    next = (index + 1) % OUTCOMES.length
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    next = (index - 1 + OUTCOMES.length) % OUTCOMES.length
  } else {
    return
  }
  e.preventDefault()
  setOutcome(OUTCOMES[next])
  const group = e.currentTarget.parentElement
  const target = group?.children[next] as HTMLElement | undefined
  target?.focus()
}

/** Inline mm:ss editor: two small numeric fields feeding a seconds total. */
function DurationEditor({
  seconds,
  onChange,
  onDone,
}: {
  seconds: number
  onChange: (seconds: number) => void
  onDone: () => void
}): React.JSX.Element {
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        aria-label="Minutes"
        value={minutes}
        onChange={(e) =>
          onChange(Math.max(0, (Number(e.target.value) || 0) * 60 + secs))
        }
        className={durationInputClass}
      />
      <span className="text-sm text-muted-foreground">m</span>
      <input
        type="number"
        min={0}
        max={59}
        step={1}
        inputMode="numeric"
        aria-label="Seconds"
        value={secs}
        onChange={(e) => {
          const s = Math.min(59, Math.max(0, Number(e.target.value) || 0))
          onChange(minutes * 60 + s)
        }}
        className={durationInputClass}
      />
      <span className="text-sm text-muted-foreground">s</span>
      <Button type="button" variant="ghost" size="sm" onClick={onDone}>
        Done
      </Button>
    </div>
  )
}

/** Circular initials avatar — no image dependency, tints when a call is live. */
function Avatar({
  name,
  live = false,
}: {
  name: string
  live?: boolean
}): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative inline-flex size-9 items-center justify-center rounded-full text-xs font-semibold',
        live
          ? 'bg-brand text-brand-foreground'
          : 'bg-brand-subtle text-brand-emphasis',
      )}
    >
      {getInitials(name)}
    </span>
  )
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const durationInputClass = cn(
  'h-9 w-14 rounded-[10px] border border-input bg-card px-2 text-center text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow,border-color] focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand/15',
)

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
