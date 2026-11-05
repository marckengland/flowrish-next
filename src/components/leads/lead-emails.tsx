'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { EmailCompose, type LatestEmailThread } from '@/components/email/email-compose'
import { EmailThread, type EmailThreadMessage } from '@/components/email/email-thread'

// ─── Emails tab ──────────────────────────────────────────────────────────────

interface ThreadGroup {
  threadId: string
  messages: EmailThreadMessage[]
}

export function EmailsTab({
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

  return (
    <div className="flex flex-col gap-4">
      {canWrite && leadEmail ? (
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

      {!leadEmail && <p className="text-sm text-muted-foreground">This lead has no email address. Linked conversation history remains available below.</p>}
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
                canWrite && !!leadEmail && thread.messages.some(message => [message.fromEmail, message.toEmail].some(address => address.toLowerCase() === leadEmail.toLowerCase()))
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
