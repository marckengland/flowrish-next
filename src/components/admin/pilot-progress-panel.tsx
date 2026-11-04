'use client'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  pilotProgressSchema,
  pilotNextSteps,
  type PilotProgress,
} from '@/lib/pilot-progress'
import { readPilot, PilotClientError } from '@/lib/pilot-client'
const rehearsalLabels = {
  not_saved: 'Not saved',
  incomplete: 'Saved rehearsal incomplete',
  unreviewed: 'Saved rehearsal needs review',
  needs_work: 'Saved rehearsal needs work',
  stale: 'Setup changed — repeat rehearsal',
  passed: 'Saved rehearsal marked passed',
}
const invitationLabels = {
  not_issued: 'Not issued',
  active: 'Active',
  expired: 'Expired',
  revoked: 'Revoked',
}
export function PilotProgressPanel({
  entryId,
  email,
  onAccessDenied,
}: {
  entryId: string
  email: string
  onAccessDenied: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [data, setData] = useState<PilotProgress | null>(null),
    [error, setError] = useState('')
  const pending = useRef(false)
  async function load() {
    if (pending.current) return
    pending.current = true
    setOpen(true)
    setBusy(true)
    setError('')
    setData(null)
    try {
      setData(
        await readPilot(
          `/api/staff/waitlist/${entryId}/pilot/progress`,
          pilotProgressSchema,
        ),
      )
    } catch (failure) {
      setError('Progress could not be checked. Refresh to try again.')
      if (
        failure instanceof PilotClientError &&
        [401, 403].includes(failure.status)
      )
        onAccessDenied()
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <div className="space-y-3">
      <Button
        variant="outline"
        disabled={busy}
        className="min-h-11 whitespace-normal"
        aria-label={`Check pilot setup progress for ${email}`}
        onClick={() => void load()}
      >
        Check pilot setup progress
      </Button>
      {open && (
        <section
          aria-label={`Pilot setup progress for ${email}`}
          className="min-w-0 space-y-4 rounded-lg border bg-background p-3 text-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Pilot setup progress</h3>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setOpen(false)
                setData(null)
                setError('')
              }}
            >
              Close pilot progress
            </Button>
          </div>
          <p>
            Milestones only. Business content, credentials, and conversations
            stay private.
          </p>
          <Button variant="outline" disabled={busy} onClick={() => void load()}>
            Refresh pilot progress
          </Button>
          {busy && (
            <p role="status" aria-label="Pilot progress status">
              Checking saved progress…
            </p>
          )}
          {error && (
            <p
              role="alert"
              aria-label="Pilot progress error"
              className="text-destructive"
            >
              {error}
            </p>
          )}
          {data && (
            <>
              <p className="text-xs text-muted-foreground">
                Checked{' '}
                <time dateTime={data.checkedAt}>
                  {new Date(data.checkedAt).toLocaleString()}
                </time>
              </p>
              {data.state === 'not_joined' && (
                <p>
                  No pilot workspace has been joined. Invitation:{' '}
                  {invitationLabels[data.invitation]}. Use the invitation
                  controls to review or replace an unused link.
                </p>
              )}
              {data.state === 'unavailable' && (
                <p>
                  Workspace progress is unavailable. Ask the business owner to
                  review their membership with Flowrish; this panel cannot
                  restore access or create another workspace.
                </p>
              )}
              {data.state === 'joined' && (
                <>
                  <dl className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-2">
                    <dt>Business details</dt>
                    <dd>
                      {data.businessSaved ? 'Saved' : 'Needs setup or review'}
                    </dd>
                    <dt>Services</dt>
                    <dd>
                      {data.knowledge.services
                        ? 'Approved'
                        : 'Missing approved document'}
                    </dd>
                    <dt>Pricing guidance</dt>
                    <dd>
                      {data.knowledge.pricing
                        ? 'Approved'
                        : 'Missing approved document'}
                    </dd>
                    <dt>FAQs</dt>
                    <dd>
                      {data.knowledge.faqs
                        ? 'Approved'
                        : 'Missing approved document'}
                    </dd>
                    <dt>Organization AI</dt>
                    <dd>
                      {data.aiConfigured
                        ? 'Configured with limits'
                        : 'Needs configuration or review'}
                    </dd>
                    <dt>Allowed website</dt>
                    <dd>{data.websiteSaved ? 'Saved' : 'Needs setup'}</dd>
                    <dt>Browser rehearsal</dt>
                    <dd>{rehearsalLabels[data.rehearsal]}</dd>
                    <dt>Widget</dt>
                    <dd>{data.widgetEnabled ? 'Widget on' : 'Widget off'}</dd>
                  </dl>
                  <div className="space-y-1 rounded-md bg-muted/40 p-3">
                    <h4 className="font-medium">Next step</h4>
                    <p>{pilotNextSteps[data.nextStep]}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    A saved review does not verify live AI quality or
                    connectivity. Unsaved local simulations are not tracked.
                    Checking progress makes no AI requests and changes no
                    settings; widget activation stays a separate manual action.
                  </p>
                </>
              )}
            </>
          )}
        </section>
      )}
    </div>
  )
}
