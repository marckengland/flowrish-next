'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { PilotInvitationPanel } from './pilot-invitation-panel'
import { PilotProgressPanel } from './pilot-progress-panel'
import {
  waitlistEntrySchema,
  waitlistListSchema,
  waitlistOptionsSchema,
  waitlistPreviewSchema,
  waitlistReceiptSchema,
  waitlistHandoffDraftSchema,
  type WaitlistEntry,
  type WaitlistList,
  type WaitlistOptions,
  type WaitlistDraft,
  type WaitlistPreview,
} from '@/lib/staff-waitlist'

const base = '/api/staff/waitlist'
const field =
  'mt-1 min-h-11 w-full rounded-md border bg-background px-3 py-2 text-sm'
class InboxError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}
async function read<T>(
  url: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init })
  const body = await response.json().catch(() => null)
  if (!response.ok)
    throw new InboxError(
      body?.error?.message ?? 'Unable to load the waitlist. Please reload.',
      response.status,
    )
  const parsed = schema.safeParse(body?.data)
  if (!parsed.success)
    throw new InboxError('Unexpected response. Please reload the inbox.', 502)
  return parsed.data
}
const json = (method: string, data: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
})

export function StaffWaitlistInbox(): React.JSX.Element {
  const [rows, setRows] = useState<WaitlistList | null>(null)
  const [filter, setFilter] = useState('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [options, setOptions] = useState<WaitlistOptions | null>(null)
  const [mode, setMode] = useState<'' | 'new' | 'existing'>('')
  const [leadId, setLeadId] = useState('')
  const [firstName, setFirstName] = useState(''),
    [lastName, setLastName] = useState('')
  const [owner, setOwner] = useState(''),
    [stage, setStage] = useState('')
  const [duplicate, setDuplicate] = useState(false)
  const [reviewed, setReviewed] = useState<{
    draft: WaitlistDraft
    preview: WaitlistPreview
  } | null>(null)
  const [approved, setApproved] = useState(false)
  const [busy, setBusy] = useState(false),
    busyRef = useRef(false)
  const [error, setError] = useState(''),
    [message, setMessage] = useState('')
  const [denied, setDenied] = useState(false)

  const perform = useCallback(async (work: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await work()
    } catch (failure) {
      setError(
        failure instanceof InboxError
          ? failure.message
          : 'The request could not be confirmed. Reload handoff to check its receipt, or reload the inbox before retrying.',
      )
      if (
        failure instanceof InboxError &&
        [401, 403].includes(failure.status)
      ) {
        setDenied(true)
        setRows(null)
        setOptions(null)
        setSelectedId(null)
        setReviewed(null)
        setApproved(false)
      }
      if (failure instanceof InboxError && failure.status === 409) {
        setReviewed(null)
        setApproved(false)
      }
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void perform(async () =>
      setRows(
        await read(`${base}?page=1&reviewStatus=all`, waitlistListSchema),
      ),
    )
  }, [perform])
  const clearApproval = () => {
    setReviewed(null)
    setApproved(false)
  }
  function denyAccess() {
    setDenied(true)
    setRows(null)
    setOptions(null)
    setSelectedId(null)
    clearApproval()
    setError('Flowrish staff access is required.')
  }
  function applyEntry(updated: WaitlistEntry) {
    setRows(
      (current) =>
        current && {
          ...current,
          entries: current.entries.map((row) =>
            row.id === updated.id ? updated : row,
          ),
        },
    )
    setOptions((current) =>
      current?.entry?.id === updated.id
        ? { ...current, entry: updated }
        : current,
    )
    clearApproval()
  }
  async function loadPage(page: number, reviewStatus = filter) {
    await perform(async () => {
      setDenied(false)
      setOptions(null)
      setSelectedId(null)
      clearApproval()
      setRows(
        await read(
          `${base}?page=${page}&reviewStatus=${reviewStatus}`,
          waitlistListSchema,
        ),
      )
    })
  }
  async function open(id: string) {
    await perform(async () => {
      setSelectedId(id)
      setOptions(null)
      clearApproval()
      setMode('')
      setLeadId('')
      setOwner('')
      setStage('')
      setDuplicate(false)
      const data = await read(`${base}/${id}/handoff`, waitlistOptionsSchema)
      setOptions(data)
      const names = (data.entry?.name ?? '').trim().split(/\s+/)
      setFirstName(names[0] ?? '')
      setLastName(names.slice(1).join(' '))
    })
  }
  async function mark(entry: WaitlistEntry, reviewStatus: string) {
    await perform(async () => {
      const updated = await read(
        `${base}/${entry.id}`,
        waitlistEntrySchema,
        json('PATCH', { reviewStatus, expectedVersion: entry.reviewVersion }),
      )
      applyEntry(updated)
      setMessage('Review status recorded. No message was sent.')
      try {
        setRows(
          await read(
            `${base}?page=${rows?.page ?? 1}&reviewStatus=${filter}`,
            waitlistListSchema,
          ),
        )
      } catch (failure) {
        if (
          failure instanceof InboxError &&
          [401, 403].includes(failure.status)
        )
          throw failure
        setMessage(
          'Review status recorded. Reload the inbox to refresh this review filter.',
        )
      }
    })
  }
  async function preview() {
    if (!options?.entry || !selectedId) return
    const draft = waitlistHandoffDraftSchema.safeParse({
      expectedVersion: options.entry.reviewVersion,
      target:
        mode === 'existing'
          ? { mode, leadId }
          : {
              mode,
              firstName,
              lastName,
              assigneeId: owner,
              stageId: stage,
              acknowledgeDuplicate: duplicate,
            },
    })
    if (!draft.success) {
      setError('Complete the destination fields before previewing.')
      return
    }
    await perform(async () => {
      clearApproval()
      setReviewed({
        draft: draft.data,
        preview: await read(
          `${base}/${selectedId}/handoff/preview`,
          waitlistPreviewSchema,
          json('POST', draft.data),
        ),
      })
    })
  }
  async function confirm() {
    if (!reviewed || !approved || !selectedId) return
    await perform(async () => {
      const receipt = await read(
        `${base}/${selectedId}/handoff`,
        waitlistReceiptSchema,
        json('POST', {
          draft: reviewed.draft,
          previewVersion: reviewed.preview.version,
          confirmed: true,
        }),
      )
      setOptions((current) => current && { ...current, receipt })
      clearApproval()
      setMessage('CRM handoff recorded. No message was sent.')
      try {
        setRows(
          await read(
            `${base}?page=${rows?.page ?? 1}&reviewStatus=${filter}`,
            waitlistListSchema,
          ),
        )
      } catch (failure) {
        if (
          failure instanceof InboxError &&
          [401, 403].includes(failure.status)
        )
          throw failure
        setMessage(
          'CRM handoff recorded. Reload the inbox to refresh review statuses.',
        )
      }
    })
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="space-y-3">
        <Link
          href="/admin"
          className="inline-flex min-h-11 items-center text-sm underline"
        >
          Back to Admin
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          Flowrish waitlist inbox
        </h1>
        <p className="text-sm text-muted-foreground">
          Private prospect signups for explicitly authorized Flowrish staff.
          Review status is separate from account invitations. Marking contacted
          records work already done; it sends no message.
        </p>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void loadPage(1)}
        >
          Reload inbox
        </Button>
      </header>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 p-3 text-sm"
        >
          {error}
        </p>
      )}
      {message && !busy && (
        <p role="status" className="rounded-lg border p-3 text-sm">
          {message}
        </p>
      )}
      {busy && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading or saving…
        </p>
      )}
      {!denied && (
        <>
          <label className="block max-w-xs text-sm font-medium">
            Review filter
            <select
              className={field}
              value={filter}
              disabled={busy}
              onChange={(event) => {
                setFilter(event.target.value)
                void loadPage(1, event.target.value)
              }}
            >
              <option value="all">All signups</option>
              <option value="new">New</option>
              <option value="reviewed">Reviewed</option>
              <option value="contacted">Contacted</option>
            </select>
          </label>
          <div className="grid min-w-0 items-start gap-6 lg:grid-cols-2">
            <section
              aria-label="Waitlist signups"
              className="min-w-0 space-y-4"
            >
              {rows?.entries.length === 0 && (
                <p>No signups match this review filter.</p>
              )}
              <ul className="space-y-4">
                {rows?.entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="min-w-0 space-y-3 rounded-xl border bg-card p-4"
                  >
                    <div className="space-y-1">
                      <h2 className="break-words font-semibold [overflow-wrap:anywhere]">
                        {entry.email}
                      </h2>
                      <p className="break-words text-sm">
                        {entry.name || 'Name not supplied'}
                      </p>
                    </div>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                      <dt className="text-muted-foreground">Review</dt>
                      <dd>{entry.reviewStatus}</dd>
                      <dt className="text-muted-foreground">Signup source</dt>
                      <dd>
                        {entry.source === 'public_demo'
                          ? 'Receptionist demo'
                          : entry.source === 'landing'
                            ? 'Homepage'
                            : 'Other or unknown'}
                      </dd>
                      <dt className="text-muted-foreground">Account status</dt>
                      <dd>{entry.status}</dd>
                      <dt className="text-muted-foreground">Signed up</dt>
                      <dd>
                        <time dateTime={entry.createdAt}>
                          {new Date(entry.createdAt).toLocaleString()}
                        </time>
                      </dd>
                    </dl>
                    <div className="flex flex-wrap gap-2">
                      {(['new', 'reviewed', 'contacted'] as const).map(
                        (status) => (
                          <Button
                            key={status}
                            variant="outline"
                            className="min-h-11"
                            aria-label={`Mark ${status} for ${entry.email}`}
                            disabled={busy || entry.reviewStatus === status}
                            onClick={() => void mark(entry, status)}
                          >
                            Mark {status}
                          </Button>
                        ),
                      )}
                    </div>
                    <Button
                      variant="outline"
                      className="min-h-11 whitespace-normal"
                      aria-label={`Prepare CRM handoff for ${entry.email}`}
                      disabled={busy || !rows.canHandoff}
                      onClick={() => void open(entry.id)}
                    >
                      Prepare CRM handoff
                    </Button>
                    {!rows.canHandoff && (
                      <p className="text-xs text-muted-foreground">
                        CRM read and write permissions are required for handoff.
                      </p>
                    )}
                    <PilotInvitationPanel
                      entryId={entry.id}
                      email={entry.email}
                      onEntryChanged={applyEntry}
                      onAccessDenied={denyAccess}
                    />
                    <PilotProgressPanel
                      entryId={entry.id}
                      email={entry.email}
                      onAccessDenied={denyAccess}
                    />
                  </li>
                ))}
              </ul>
              {rows && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="outline"
                    disabled={busy || rows.page <= 1}
                    onClick={() => void loadPage(rows.page - 1)}
                  >
                    Previous page
                  </Button>
                  <span className="text-sm">Page {rows.page}</span>
                  <Button
                    variant="outline"
                    disabled={busy || !rows.hasNext}
                    onClick={() => void loadPage(rows.page + 1)}
                  >
                    Next page
                  </Button>
                </div>
              )}
            </section>
            {selectedId && (
              <section
                aria-label="Waitlist CRM handoff"
                className="min-w-0 space-y-4 rounded-xl border bg-card p-4 sm:p-5"
              >
                <h2 className="text-lg font-semibold">Review CRM handoff</h2>
                <p className="text-sm text-muted-foreground">
                  Choose a destination and review the exact details before
                  approval. This creates or links a lead only. It does not
                  request a callback, create a task, send email, or invite an
                  account.
                </p>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void open(selectedId)}
                >
                  Reload handoff
                </Button>
                {options?.receipt ? (
                  <section
                    aria-label="CRM handoff receipt"
                    className="space-y-2 rounded-lg border p-3 text-sm"
                  >
                    <h3 className="font-semibold">CRM handoff receipt</h3>
                    <p>
                      {options.receipt.createdLead
                        ? 'New lead created'
                        : 'Existing lead linked'}
                      . This signup has already been handed to CRM.
                    </p>
                    {options.receipt.leadAvailable ? (
                      <Link
                        href={`/leads/${options.receipt.leadId}`}
                        className="inline-flex min-h-11 items-center underline"
                      >
                        Open approved lead
                      </Link>
                    ) : (
                      <p>
                        Lead no longer available. The receipt is retained; the
                        lead will not be recreated.
                      </p>
                    )}
                    <p className="text-muted-foreground">
                      No message was sent by this handoff.
                    </p>
                  </section>
                ) : (
                  options?.entry && (
                    <>
                      <p className="break-words text-sm [overflow-wrap:anywhere]">
                        Signup: {options.entry.name || 'Name not supplied'} ·{' '}
                        {options.entry.email}
                      </p>
                      {options.matchesTruncated && (
                        <p className="text-sm">
                          Only the first 20 matching active leads are shown.
                          Review CRM before creating another lead.
                        </p>
                      )}
                      {options.choicesTruncated && (
                        <p className="text-sm">
                          Only the first 200 owners and open stages are shown.
                        </p>
                      )}
                      <fieldset disabled={busy} className="space-y-3">
                        <legend className="mb-2 text-sm font-medium">
                          CRM destination
                        </legend>
                        <label className="flex min-h-11 items-center gap-2 text-sm">
                          <input
                            type="radio"
                            name="waitlist-target"
                            checked={mode === 'existing'}
                            disabled={options.leads.length === 0}
                            onChange={() => {
                              setMode('existing')
                              clearApproval()
                            }}
                          />
                          Link an existing matching lead
                        </label>
                        <label className="flex min-h-11 items-center gap-2 text-sm">
                          <input
                            type="radio"
                            name="waitlist-target"
                            checked={mode === 'new'}
                            onChange={() => {
                              setMode('new')
                              clearApproval()
                            }}
                          />
                          Create a new lead
                        </label>
                        {mode === 'existing' && (
                          <label className="block text-sm font-medium">
                            Matching active lead
                            <select
                              className={field}
                              value={leadId}
                              onChange={(event) => {
                                setLeadId(event.target.value)
                                clearApproval()
                              }}
                            >
                              <option value="">Choose a matching lead</option>
                              {options.leads.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        {mode === 'new' && (
                          <div className="space-y-3">
                            <label className="block text-sm font-medium">
                              Lead first name
                              <input
                                className={field}
                                value={firstName}
                                maxLength={120}
                                onChange={(event) => {
                                  setFirstName(event.target.value)
                                  clearApproval()
                                }}
                              />
                            </label>
                            <label className="block text-sm font-medium">
                              Lead last name
                              <input
                                className={field}
                                value={lastName}
                                maxLength={120}
                                onChange={(event) => {
                                  setLastName(event.target.value)
                                  clearApproval()
                                }}
                              />
                            </label>
                            <label className="block text-sm font-medium">
                              Lead owner
                              <select
                                className={field}
                                value={owner}
                                onChange={(event) => {
                                  setOwner(event.target.value)
                                  clearApproval()
                                }}
                              >
                                <option value="">
                                  Choose an organization member
                                </option>
                                {options.members.map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {item.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="block text-sm font-medium">
                              Open stage
                              <select
                                className={field}
                                value={stage}
                                onChange={(event) => {
                                  setStage(event.target.value)
                                  clearApproval()
                                }}
                              >
                                <option value="">Choose an open stage</option>
                                {options.stages.map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {item.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            {options.leads.length > 0 && (
                              <label className="flex min-h-11 items-start gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={duplicate}
                                  onChange={(event) => {
                                    setDuplicate(event.target.checked)
                                    clearApproval()
                                  }}
                                />
                                I reviewed the matching leads and approve
                                creating another lead.
                              </label>
                            )}
                          </div>
                        )}
                      </fieldset>
                      <Button
                        className="min-h-11"
                        disabled={busy || !mode}
                        onClick={() => void preview()}
                      >
                        Preview CRM handoff
                      </Button>
                      {reviewed && (
                        <section
                          aria-label="CRM handoff preview"
                          className="space-y-3 rounded-lg border p-3 text-sm"
                        >
                          <h3 className="font-semibold">CRM handoff preview</h3>
                          <p className="break-words [overflow-wrap:anywhere]">
                            {reviewed.preview.action === 'create'
                              ? 'Create a lead'
                              : 'Link the selected existing lead'}{' '}
                            in {reviewed.preview.organizationName}:{' '}
                            {reviewed.preview.targetLabel} ·{' '}
                            {reviewed.preview.email}
                          </p>
                          {reviewed.preview.ownerLabel && (
                            <p>Owner: {reviewed.preview.ownerLabel}</p>
                          )}
                          {reviewed.preview.stageLabel && (
                            <p>Stage: {reviewed.preview.stageLabel}</p>
                          )}
                          {reviewed.preview.action === 'link' && (
                            <p>
                              Existing lead details and ownership stay
                              unchanged.
                            </p>
                          )}
                          <p>
                            No task, callback, email, or invitation will be
                            created.
                          </p>
                          <label className="flex min-h-11 items-center gap-2">
                            <input
                              type="checkbox"
                              checked={approved}
                              disabled={busy}
                              onChange={(event) =>
                                setApproved(event.target.checked)
                              }
                            />
                            I approve this CRM handoff.
                          </label>
                          <Button
                            className="min-h-11"
                            disabled={busy || !approved}
                            onClick={() => void confirm()}
                          >
                            Confirm CRM handoff
                          </Button>
                        </section>
                      )}
                    </>
                  )
                )}
              </section>
            )}
          </div>
        </>
      )}
    </div>
  )
}
