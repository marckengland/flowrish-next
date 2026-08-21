'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  Check,
  CheckSquare,
  FileText,
  Mail,
  MessageSquare,
  Plus,
  Trash2,
  Users,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ActivityTimeline } from '@/components/activities/activity-timeline'
import { ActivityForm } from '@/components/activities/activity-form'
import { AuditLogTable } from '@/components/admin/audit-log-table'
import { EmailCompose, type LatestEmailThread } from '@/components/email/email-compose'
import {
  EmailThread,
  type EmailThreadMessage,
} from '@/components/email/email-thread'
import { FileUpload } from '@/components/activities/file-upload'
import type { ActivityItem } from '@/hooks/use-activities'

/**
 * Tabbed lead detail surface — "Activities" (timeline + composer +
 * email + file upload), "Contacts" (linked contacts list with link /
 * unlink), "Tasks" (per-lead task list with quick-complete), and
 * "Audit Log" (entity-scoped audit history).
 *
 * The tabs share state at the page level so switching tabs is instant
 * and the activity timeline retains its TanStack Query cache. Each tab
 * is rendered eagerly (rather than lazily mounted) so the React Query
 * hooks inside fire once and stay warm — critical for the activity tab
 * which the user will return to frequently.
 *
 * Validates: Requirements 4.1, 4.4, 18.1, 19.4, 20.3, 31.1
 */

type TabKey = 'activities' | 'emails' | 'contacts' | 'tasks' | 'audit'

const TABS: ReadonlyArray<{ key: TabKey; label: string; icon: typeof MessageSquare }> = [
  { key: 'activities', label: 'Activities', icon: MessageSquare },
  { key: 'emails', label: 'Emails', icon: Mail },
  { key: 'contacts', label: 'Contacts', icon: Users },
  { key: 'tasks', label: 'Tasks', icon: CheckSquare },
  { key: 'audit', label: 'Audit log', icon: FileText },
]

export interface LeadContactSummary {
  contact: {
    id: string
    firstName: string
    lastName: string
    email: string | null
    phone: string | null
    jobTitle: string | null
  }
}

export interface LeadTabsProps {
  leadId: string
  leadName: string
  leadEmail: string | null
  /** Initial activity list for the timeline so it paints immediately. */
  initialActivities: ActivityItem[]
  /** Linked contacts pre-loaded by the page. */
  contacts: readonly LeadContactSummary[]
  /**
   * Most recent thread for this lead. When supplied, the email
   * compose form defaults to replying on this thread; the user can
   * still flip a toggle to start a fresh conversation. Hydrated
   * server-side by the lead detail page.
   */
  latestThread?: LatestEmailThread
  canWrite: boolean
}

export function LeadTabs({
  leadId,
  leadName,
  leadEmail,
  initialActivities,
  contacts,
  latestThread,
  canWrite,
}: LeadTabsProps): React.JSX.Element {
  const [active, setActive] = useState<TabKey>('activities')

  return (
    <div className="rounded-lg border bg-card">
      <div role="tablist" aria-label="Lead detail" className="flex border-b">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const isActive = active === tab.key
          return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(tab.key)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {tab.label}
            </button>
          )
        })}
      </div>
      <div className="p-4">
        {/* Each tab pane is mounted/unmounted on demand so we don't pay for
            the unused tabs' fetches. The activity timeline keeps its
            cache via TanStack Query so re-mounting is cheap. */}
        {active === 'activities' && (
          <ActivitiesTab
            leadId={leadId}
            leadName={leadName}
            leadEmail={leadEmail}
            initialActivities={initialActivities}
            latestThread={latestThread}
            canWrite={canWrite}
          />
        )}
        {active === 'emails' && (
          <EmailsTab
            leadId={leadId}
            leadName={leadName}
            leadEmail={leadEmail}
            latestThread={latestThread}
            canWrite={canWrite}
          />
        )}
        {active === 'contacts' && (
          <ContactsTab
            leadId={leadId}
            initialContacts={contacts}
            canWrite={canWrite}
          />
        )}
        {active === 'tasks' && (
          <TasksTab leadId={leadId} canWrite={canWrite} />
        )}
        {active === 'audit' && (
          <AuditLogTable entityType="Lead" entityId={leadId} />
        )}
      </div>
    </div>
  )
}

// ─── Activities tab ──────────────────────────────────────────────────────────

function ActivitiesTab({
  leadId,
  leadName,
  leadEmail,
  initialActivities,
  latestThread,
  canWrite,
}: {
  leadId: string
  leadName: string
  leadEmail: string | null
  initialActivities: ActivityItem[]
  latestThread?: LatestEmailThread
  canWrite: boolean
}): React.JSX.Element {
  const [showFileUpload, setShowFileUpload] = useState(false)
  return (
    <div className="flex flex-col gap-4">
      {canWrite && leadEmail ? (
        <EmailCompose
          leadId={leadId}
          leadEmail={leadEmail}
          leadName={leadName}
          latestThread={latestThread}
          alwaysOpen={false}
        />
      ) : null}
      {canWrite ? (
        <div className="flex flex-col gap-2">
          <ActivityForm leadId={leadId} />
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowFileUpload((v) => !v)}
            >
              {showFileUpload ? 'Hide file upload' : 'Attach file'}
            </Button>
          </div>
          {showFileUpload ? (
            <FileUpload
              leadId={leadId}
              onUploaded={() => setShowFileUpload(false)}
              onCancel={() => setShowFileUpload(false)}
            />
          ) : null}
        </div>
      ) : null}
      <ActivityTimeline
        leadId={leadId}
        initialActivities={initialActivities}
      />
    </div>
  )
}

// ─── Contacts tab ────────────────────────────────────────────────────────────

interface ContactOption {
  id: string
  firstName: string
  lastName: string
  email: string | null
}

function ContactsTab({
  leadId,
  initialContacts,
  canWrite,
}: {
  leadId: string
  initialContacts: readonly LeadContactSummary[]
  canWrite: boolean
}): React.JSX.Element {
  const router = useRouter()
  const [showLink, setShowLink] = useState(false)
  const [target, setTarget] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Load org-wide contacts only when the user opens the link picker
  // — the typical lead has zero or one linked contacts and most users
  // never expand this UI, so deferring the fetch keeps the lead detail
  // page lean.
  const { data: allContacts = [], isLoading } = useQuery<ContactOption[]>({
    queryKey: ['contacts', 'all', 'min'],
    enabled: showLink,
    queryFn: async () => {
      const res = await fetch('/api/contacts?pageSize=200', {
        credentials: 'same-origin',
      })
      if (!res.ok) throw new Error('Failed to load contacts')
      const body = (await res.json()) as { data: ContactOption[] }
      return body.data
    },
  })

  const linkedIds = useMemo(
    () => new Set(initialContacts.map((c) => c.contact.id)),
    [initialContacts],
  )
  const available = allContacts.filter((c) => !linkedIds.has(c.id))

  function link(): void {
    if (!target) return
    setError(null)
    startTransition(async () => {
      const res = await fetch('/api/contacts/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ leadId, contactId: target }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setError(body.error?.message ?? `Link failed (${res.status})`)
        return
      }
      setTarget('')
      setShowLink(false)
      router.refresh()
    })
  }

  function unlink(contactId: string): void {
    setError(null)
    startTransition(async () => {
      const res = await fetch('/api/contacts/link', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ leadId, contactId }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setError(body.error?.message ?? `Unlink failed (${res.status})`)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          Linked contacts ({initialContacts.length})
        </p>
        {canWrite && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowLink((v) => !v)}
            disabled={pending}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            <span>Link contact</span>
          </Button>
        )}
      </div>

      {showLink && canWrite && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3">
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={isLoading || pending}
            className="h-8 flex-1 rounded border bg-background px-2 text-sm"
          >
            <option value="">
              {isLoading ? 'Loading…' : 'Select a contact…'}
            </option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {c.firstName} {c.lastName}
                {c.email ? ` (${c.email})` : ''}
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            onClick={link}
            disabled={!target || pending}
          >
            Link
          </Button>
        </div>
      )}

      {error ? (
        <p role="alert" className="text-xs text-danger-foreground">
          {error}
        </p>
      ) : null}

      {initialContacts.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No contacts linked to this lead.
        </p>
      ) : (
        <div className="divide-y rounded-md border">
          {initialContacts.map(({ contact }) => (
            <div
              key={contact.id}
              className="flex items-center justify-between px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {contact.firstName} {contact.lastName}
                </p>
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  {contact.email ? <span>{contact.email}</span> : null}
                  {contact.phone ? <span>{contact.phone}</span> : null}
                  {contact.jobTitle ? <span>{contact.jobTitle}</span> : null}
                </div>
              </div>
              {canWrite && (
                <button
                  type="button"
                  onClick={() => unlink(contact.id)}
                  disabled={pending}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-danger-subtle hover:text-danger-foreground"
                  aria-label={`Unlink ${contact.firstName} ${contact.lastName}`}
                  title="Unlink"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Tasks tab ───────────────────────────────────────────────────────────────

interface LeadTask {
  id: string
  title: string
  description: string | null
  priority: 'LOW' | 'MEDIUM' | 'HIGH'
  dueDate: string
  isComplete: boolean
  assignee: { id: string; name: string } | null
}

const PRIORITY_TONE: Record<LeadTask['priority'], string> = {
  HIGH: 'text-danger-foreground',
  MEDIUM: 'text-warning-foreground',
  LOW: 'text-brand-emphasis',
}

function TasksTab({
  leadId,
  canWrite,
}: {
  leadId: string
  canWrite: boolean
}): React.JSX.Element {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const { data: tasks = [], isLoading } = useQuery<LeadTask[]>({
    queryKey: ['tasks', 'lead', leadId],
    queryFn: async () => {
      const res = await fetch(`/api/tasks?leadId=${leadId}`, {
        credentials: 'same-origin',
      })
      if (!res.ok) throw new Error('Failed to load tasks')
      const body = (await res.json()) as { data: LeadTask[] }
      return body.data
    },
  })

  function complete(taskId: string): void {
    setError(null)
    startTransition(async () => {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ isComplete: true }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setError(body.error?.message ?? `Failed (${res.status})`)
        return
      }
      router.refresh()
    })
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading tasks…</p>
  }

  if (tasks.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No tasks for this lead.
      </p>
    )
  }

  const now = Date.now()

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <p role="alert" className="text-xs text-danger-foreground">
          {error}
        </p>
      ) : null}
      <div className="divide-y rounded-md border">
        {tasks.map((task) => {
          const dueMs = new Date(task.dueDate).getTime()
          const isOverdue = !task.isComplete && dueMs < now
          return (
            <div
              key={task.id}
              className="flex items-center gap-3 px-3 py-2.5"
            >
              <button
                type="button"
                onClick={() => !task.isComplete && complete(task.id)}
                disabled={!canWrite || task.isComplete || pending}
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded border transition-colors',
                  task.isComplete
                    ? 'border-brand bg-brand text-brand-foreground'
                    : 'border-muted-foreground/30 hover:border-brand disabled:opacity-50',
                )}
                title={
                  task.isComplete
                    ? 'Completed'
                    : canWrite
                      ? 'Mark complete'
                      : "You can't complete tasks"
                }
              >
                {task.isComplete ? <Check className="size-3" /> : null}
              </button>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'text-sm font-medium',
                    task.isComplete && 'text-muted-foreground line-through',
                  )}
                >
                  {task.title}
                </p>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  <span className={PRIORITY_TONE[task.priority]}>
                    {task.priority}
                  </span>
                  <span
                    className={cn(
                      isOverdue ? 'font-medium text-danger-foreground' : null,
                    )}
                  >
                    Due {new Date(task.dueDate).toLocaleDateString()}
                    {isOverdue ? ' (overdue)' : null}
                  </span>
                  {task.assignee ? <span>Assignee: {task.assignee.name}</span> : null}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}


// ─── Emails tab ──────────────────────────────────────────────────────────────

interface ThreadGroup {
  threadId: string
  messages: EmailThreadMessage[]
}

function EmailsTab({
  leadId,
  leadName,
  leadEmail,
  latestThread,
  canWrite,
}: {
  leadId: string
  leadName: string
  leadEmail: string | null
  latestThread?: LatestEmailThread
  canWrite: boolean
}): React.JSX.Element {
  const [replyContext, setReplyContext] = useState<
    { threadId: string; subject: string } | null
  >(null)

  const { data: threads = [], isLoading, isError, error } = useQuery<
    ThreadGroup[]
  >({
    queryKey: ['email-threads', leadId],
    queryFn: async () => {
      const res = await fetch(`/api/email/threads/${leadId}`, {
        credentials: 'same-origin',
      })
      if (!res.ok) throw new Error('Failed to load email threads')
      const body = (await res.json()) as { data: ThreadGroup[] }
      return body.data
    },
  })

  if (!leadEmail) {
    return (
      <p className="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
        This lead doesn&apos;t have an email address yet.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {canWrite ? (
        replyContext ? (
          <EmailCompose
            leadId={leadId}
            leadEmail={leadEmail}
            leadName={leadName}
            replyToThreadId={replyContext.threadId}
            replySubject={replyContext.subject}
            onSent={() => setReplyContext(null)}
          />
        ) : (
          <EmailCompose
            leadId={leadId}
            leadEmail={leadEmail}
            leadName={leadName}
            latestThread={latestThread}
            alwaysOpen={false}
          />
        )
      ) : null}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading email threads…</p>
      ) : isError ? (
        <p role="alert" className="text-sm text-danger-foreground">
          {error instanceof Error
            ? error.message
            : 'Failed to load email threads.'}
        </p>
      ) : threads.length === 0 ? (
        <p className="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
          No email threads with this lead yet.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {threads.map((thread) => (
            <EmailThread
              key={thread.threadId}
              threadId={thread.threadId}
              messages={thread.messages}
              onReply={
                canWrite
                  ? (threadId, last) =>
                      setReplyContext({
                        threadId,
                        subject: last.subject,
                      })
                  : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}
