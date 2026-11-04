'use client'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  pilotStaffSchema,
  pilotPreviewSchema,
  pilotIssueResultSchema,
  type PilotStaffData,
  type PilotPreview,
} from '@/lib/pilot-onboarding'
import type { WaitlistEntry } from '@/lib/staff-waitlist'
import { readPilot, pilotJsonBody, PilotClientError } from '@/lib/pilot-client'

export function PilotInvitationPanel({
  entryId,
  email,
  onEntryChanged,
  onAccessDenied,
}: {
  entryId: string
  email: string
  onEntryChanged: (entry: WaitlistEntry) => void
  onAccessDenied?: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false),
    [data, setData] = useState<PilotStaffData | null>(null)
  const [review, setReview] = useState<{
      preview: PilotPreview
      requestId: string
    } | null>(null),
    [approved, setApproved] = useState(false),
    [revokeApproved, setRevokeApproved] = useState(false)
  const [link, setLink] = useState<string | null>(null),
    [lost, setLost] = useState(false)
  const [busy, setBusy] = useState(false),
    pending = useRef(false)
  const [error, setError] = useState(''),
    [message, setMessage] = useState('')
  const base = `/api/staff/waitlist/${entryId}/pilot`
  function clear() {
    setReview(null)
    setApproved(false)
    setRevokeApproved(false)
  }
  function apply(next: PilotStaffData) {
    setData(next)
    onEntryChanged(next.entry)
  }
  async function perform(work: () => Promise<void>) {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await work()
    } catch (failure) {
      setError(
        failure instanceof PilotClientError
          ? failure.message
          : 'The request could not be confirmed. Reload invitation to check its status before retrying.',
      )
      if (
        failure instanceof PilotClientError &&
        [401, 403].includes(failure.status)
      ) {
        setData(null)
        setLink(null)
        clear()
        onAccessDenied?.()
      }
      if (failure instanceof PilotClientError && failure.status === 409) clear()
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  async function load() {
    await perform(async () => {
      setOpen(true)
      clear()
      setLink(null)
      setLost(false)
      apply(await readPilot(base, pilotStaffSchema))
    })
  }
  async function preview() {
    if (!data) return
    await perform(async () => {
      clear()
      setReview({
        preview: await readPilot(
          `${base}/preview`,
          pilotPreviewSchema,
          pilotJsonBody({ expectedVersion: data.entry.reviewVersion }),
        ),
        requestId: crypto.randomUUID(),
      })
    })
  }
  async function issue() {
    if (!data || !review || !approved) return
    await perform(async () => {
      const result = await readPilot(
        base,
        pilotIssueResultSchema,
        pilotJsonBody({
          expectedVersion: data.entry.reviewVersion,
          previewVersion: review.preview.version,
          requestId: review.requestId,
          confirmed: true,
        }),
      )
      apply(result)
      clear()
      setLink(result.link)
      setLost(!result.link)
      setMessage('Pilot invitation recorded. No message was sent.')
    })
  }
  async function revoke() {
    if (!data?.invitation || !revokeApproved) return
    await perform(async () => {
      apply(
        await readPilot(
          `${base}/revoke`,
          pilotStaffSchema,
          pilotJsonBody({
            expectedVersion: data.entry.reviewVersion,
            generation: data.invitation!.generation,
            confirmed: true,
          }),
        ),
      )
      clear()
      setLink(null)
      setLost(false)
      setMessage('The unused link is revoked. You can review a new invitation.')
    })
  }
  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setMessage(
        'Private link copied. Share it manually only with the invited person.',
      )
    } catch {
      setError('Clipboard unavailable. Select and copy the private link above.')
    }
  }
  const canIssue =
    data &&
    data.entry.status !== 'joined' &&
    (!data.invitation || ['expired', 'revoked'].includes(data.invitation.state))
  return (
    <div className="space-y-3">
      <Button
        variant="outline"
        className="min-h-11 whitespace-normal"
        aria-label={`Manage pilot invitation for ${email}`}
        disabled={busy}
        onClick={() => void load()}
      >
        Manage pilot invitation
      </Button>
      {open && (
        <section
          aria-label={`Pilot invitation for ${email}`}
          className="min-w-0 space-y-4 rounded-lg border bg-background p-3 text-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Pilot onboarding</h3>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setOpen(false)
                setLink(null)
                setData(null)
                clear()
              }}
            >
              Close pilot invitation
            </Button>
          </div>
          <p>
            Approve this signup to create a private link for the invited person
            to create their own organization. No email or message is sent. This
            does not add them to your organization.
          </p>
          <Button variant="outline" disabled={busy} onClick={() => void load()}>
            Reload invitation
          </Button>
          {busy && (
            <p role="status" aria-label="Pilot invitation status">
              Loading or saving…
            </p>
          )}
          {!busy && message && (
            <p role="status" aria-label="Pilot invitation status">
              {message}
            </p>
          )}
          {error && (
            <p
              role="alert"
              aria-label="Pilot invitation error"
              className="text-destructive"
            >
              {error}
            </p>
          )}
          {data?.invitation && (
            <div className="space-y-1">
              <p>
                Invitation: {data.invitation.state} · generation{' '}
                {data.invitation.generation}
              </p>
              <p className="break-words [overflow-wrap:anywhere]">
                Invited email: {data.invitation.email}
              </p>
              <p>
                Expires:{' '}
                <time dateTime={data.invitation.expiresAt}>
                  {new Date(data.invitation.expiresAt).toLocaleString()}
                </time>
              </p>
            </div>
          )}
          {link && (
            <div className="space-y-2">
              <label className="block font-medium">
                Private pilot link
                <input
                  readOnly
                  value={link}
                  autoComplete="off"
                  spellCheck={false}
                  className="mt-1 min-h-11 w-full rounded-md border px-3 text-sm"
                />
              </label>
              <p>
                This link is shown only in this panel. Copy it now; closing or
                reloading hides it. Flowrish stores only a hash.
              </p>
              <Button disabled={busy} onClick={() => void copy()}>
                Copy private link
              </Button>
            </div>
          )}
          {lost && (
            <p>
              Flowrish cannot recover the private link from an earlier or
              uncertain response. Revoke it and explicitly issue a new link if
              you still need one.
            </p>
          )}
          {canIssue && (
            <Button disabled={busy} onClick={() => void preview()}>
              Preview pilot invitation
            </Button>
          )}
          {review && (
            <div className="space-y-3 rounded-md border p-3">
              <h4 className="font-semibold">Approve pilot access</h4>
              <p className="break-words [overflow-wrap:anywhere]">
                Recipient: {review.preview.email}. The link expires seven days
                after issuance. Redemption requires this verified email and
                creates a separate workspace with the prospect as owner.
              </p>
              <p>
                Our team will confirm pricing. Issuing this link does not call
                AI, enable a widget, or grant staff access.
              </p>
              <label className="flex min-h-11 items-start gap-2">
                <input
                  type="checkbox"
                  checked={approved}
                  disabled={busy}
                  onChange={(event) => setApproved(event.target.checked)}
                />
                I approve pilot access for this signup.
              </label>
              <Button disabled={busy || !approved} onClick={() => void issue()}>
                Issue private pilot link
              </Button>
            </div>
          )}
          {data?.invitation &&
            data.invitation.state !== 'joined' &&
            data.invitation.state !== 'revoked' && (
              <div className="space-y-3 rounded-md border p-3">
                <label className="flex min-h-11 items-start gap-2">
                  <input
                    type="checkbox"
                    checked={revokeApproved}
                    disabled={busy}
                    onChange={(event) =>
                      setRevokeApproved(event.target.checked)
                    }
                  />
                  I confirm revoking this unused invitation link.
                </label>
                <Button
                  variant="outline"
                  disabled={busy || !revokeApproved}
                  onClick={() => void revoke()}
                >
                  Revoke unused link
                </Button>
              </div>
            )}
          {data?.invitation?.state === 'joined' && (
            <p>
              This invitation has been used. The workspace receipt is retained;
              this panel cannot create another workspace or change its
              membership.
            </p>
          )}
        </section>
      )}
    </div>
  )
}
