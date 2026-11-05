import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

import { requireSession } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { getLeadAccessFilter } from '@/server/services/access'
import { getLeadById } from '@/server/services/leads'
import { getActivitiesByLead } from '@/server/services/activities'
import { getOrCreateDefaultPipeline } from '@/server/services/pipeline'
import { createTenantPrisma } from '@/server/db/middleware'
import { prisma } from '@/server/db/client'
import { AppError } from '@/lib/errors'

import { ClickToCall } from '@/components/leads/click-to-call'
import { LeadConvert } from '@/components/leads/lead-convert'
import { LeadDetail } from '@/components/leads/lead-detail'
import { LeadDealCard } from '@/components/leads/lead-deal-card'
import { LeadStageTransition } from '@/components/leads/lead-stage-transition'
import { LeadTabs } from '@/components/leads/lead-tabs'
import { DuplicateCheck } from '@/components/leads/duplicate-check'
import { DeletionRequestButton } from '@/components/leads/deletion-request-button'
import { ConversationIntelligence } from '@/components/rhythm/conversation-intelligence'
import { EmailGenerator } from '@/components/ai/email-generator'
import { AccountResearch } from '@/components/ai/account-research'
import type { ActivityItem } from '@/hooks/use-activities'
import type { LeadFormStage, LeadFormValues } from '@/components/leads/lead-form'

/**
 * Lead detail page — Server Component.
 *
 * Responsibilities:
 * 1. Require an authenticated session plus `leads:read` permission.
 * 2. Resolve the lead through the RBAC-scoped service so users can only
 *    see leads within their access scope (OWNER/ADMIN → all org leads,
 *    MANAGER → accessible teams, MEMBER → their own assignments).
 * 3. Pre-load the activity timeline and pipeline stages server-side so
 *    the page paints immediately and the client components adopt the
 *    data as their TanStack Query initial cache.
 * 4. Compose the read/edit panel, convert control, activity timeline,
 *    activity composer, and conversation intelligence surface.
 *
 * Validates: Requirements 4.1, 4.2, 5.1, 5.2, 5.4, 29.1, 30.1, 31.1, 31.3
 */
export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<React.JSX.Element> {
  const { id } = await params
  const session = await requireSession()

  if (!hasPermission(session.dbUser, 'leads:read')) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-md border bg-card p-6">
        <h1 className="text-lg font-semibold">Lead</h1>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view leads in this organization.
        </p>
      </div>
    )
  }

  const canWrite = hasPermission(session.dbUser, 'leads:write')
  const canDelete = hasPermission(session.dbUser, 'leads:delete')
  // Coaching is a manager-level capability — Requirement 30.4.
  const canCoach = hasPermission(session.dbUser, 'leads:write')

  const accessFilter = await getLeadAccessFilter(session.dbUser, session.organizationId)

  let lead
  try {
    lead = await getLeadById(id, accessFilter, session.organizationId)
  } catch (err) {
    if (err instanceof AppError && err.code === 'LEAD_NOT_FOUND') {
      notFound()
    }
    throw err
  }

  const [activities, pipeline, org] = await Promise.all([
    getActivitiesByLead(id, session.organizationId),
    getOrCreateDefaultPipeline(session.organizationId),
    prisma.organization.findUnique({
      where: { id: session.organizationId },
      select: { voiceProvider: true },
    }),
  ])

  // Look up the lead's most recent email thread so the compose form
  // can default to "reply on existing thread" — matches the typical
  // mail-client behaviour the original Flowrish app shipped. We only
  // surface the toggle when a thread exists and the lead has an email.
  let latestThread: {
    threadId: string
    subject: string
    lastSentAt: string
  } | undefined
  if (lead.email) {
    const tenantDb = createTenantPrisma(session.organizationId)
    const latestMessage = await tenantDb.emailMessage.findFirst({
      where: {
        threadId: { not: null },
        OR: [
          { fromEmail: { equals: lead.email, mode: 'insensitive' } },
          { toEmail: { equals: lead.email, mode: 'insensitive' } },
        ],
      },
      orderBy: { sentAt: 'desc' },
      select: { threadId: true, subject: true, sentAt: true },
    })
    if (latestMessage?.threadId) {
      latestThread = {
        threadId: latestMessage.threadId,
        subject: latestMessage.subject,
        lastSentAt: latestMessage.sentAt.toISOString(),
      }
    }
  }

  const stages: LeadFormStage[] = pipeline.stages
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((s) => ({ id: s.id, name: s.name, order: s.order }))

  /**
   * Stage list with terminal-state flags, used by LeadStageTransition
   * so it can render the lock icons and reopen-helper text. The form
   * itself only needs id/name/order so we keep two derived shapes.
   */
  const stageOptions = pipeline.stages
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((s) => ({
      id: s.id,
      name: s.name,
      order: s.order,
      isClosedWon: s.isClosedWon,
      isClosedLost: s.isClosedLost,
    }))

  const initialLeadValues: LeadFormValues = {
    id: lead.id,
    firstName: lead.firstName,
    lastName: lead.lastName,
    stageId: lead.stageId,
    email: lead.email,
    altEmail: lead.altEmail,
    phone: lead.phone,
    title: lead.title,
    description: lead.description,
    dealValue: lead.dealValue === null ? null : String(lead.dealValue),
    currency: lead.currency,
    score: lead.score,
    leadStatus: lead.leadStatus,
    tier: lead.tier,
    linkedinUrl: lead.linkedinUrl,
    country: lead.country,
    state: lead.state,
    companyName: lead.companyName,
    companyIndustry: lead.companyIndustry,
    companyWebsite: lead.companyWebsite,
    companyLinkedinUrl: lead.companyLinkedinUrl,
  }

  const initialActivities: ActivityItem[] = activities.map(toActivityItem)

  // Requirement 29.2: only open leads can be converted. A lead already in
  // a terminal stage (isClosed=true) should not display the convert CTA.
  const alreadyConverted = Boolean(
    lead.isClosed || lead.stage?.isClosedWon || lead.stage?.isClosedLost,
  )

  return (
    <div className="flex max-w-[1080px] flex-col gap-5">
      <nav>
        <Link
          href="/leads"
          className="inline-flex items-center gap-1.5 font-mono text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          <span>Back to leads</span>
        </Link>
      </nav>

      <div className="grid grid-cols-1 gap-[18px] lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <LeadDetail
            lead={{
              ...initialLeadValues,
              stage: lead.stage
                ? {
                    id: lead.stage.id,
                    name: lead.stage.name,
                    isClosedWon: lead.stage.isClosedWon,
                    isClosedLost: lead.stage.isClosedLost,
                  }
                : undefined,
              assignedUser: lead.assignedUser
                ? {
                    id: lead.assignedUser.id,
                    name: lead.assignedUser.name,
                    email: lead.assignedUser.email,
                  }
                : null,
              companyName: lead.companyName,
              lastActivityAt: lead.lastActivityAt
                ? lead.lastActivityAt.toISOString()
                : null,
            }}
            stages={stages}
            canEdit={canWrite}
          />

          <LeadStageTransition
            leadId={lead.id}
            currentStageId={lead.stageId}
            stages={stageOptions}
            canEdit={canWrite}
          />

          <LeadTabs
            leadId={lead.id}
            leadName={`${lead.firstName} ${lead.lastName}`.trim()}
            leadEmail={lead.email}
            initialActivities={initialActivities}
            latestThread={latestThread}
            contacts={(lead.contacts ?? []).map((entry) => ({
              contact: {
                id: entry.contact.id,
                firstName: entry.contact.firstName,
                lastName: entry.contact.lastName,
                email: entry.contact.email,
                phone: entry.contact.phone,
                jobTitle: entry.contact.jobTitle,
              },
            }))}
            canWrite={canWrite}
          />

          <section
            aria-label="Conversation intelligence"
            className="flex flex-col gap-3 rounded-lg border border-brand/30 bg-brand-subtle p-[18px]"
          >
            <h2 className="text-sm font-semibold text-brand-emphasis">
              Conversation intelligence
            </h2>
            <ConversationIntelligence leadId={lead.id} canCoach={canCoach} />
          </section>

          {canWrite && (
            <section
              aria-label="AI Tools"
              className="flex flex-col gap-3 rounded-lg border border-ai/30 bg-ai-subtle p-[18px]"
            >
              <h2 className="text-sm font-semibold text-ai">AI Tools</h2>
              <EmailGenerator leadId={lead.id} />
              {lead.companyId && (
                <AccountResearch companyId={lead.companyId} />
              )}
            </section>
          )}
        </div>

        <aside className="flex flex-col gap-[18px] lg:sticky lg:top-6 lg:self-start">
          <LeadDealCard
            leadStatus={lead.leadStatus}
            tier={lead.tier}
            stageName={lead.stage?.name}
            dealValue={lead.dealValue === null ? null : String(lead.dealValue)}
            currency={lead.currency}
            score={lead.score}
          />

          <section
            aria-label="Call lead"
            className="flex flex-col gap-3 rounded-lg border bg-card p-[18px]"
          >
            <h2 className="text-sm font-semibold">Call</h2>
            <ClickToCall
              leadId={lead.id}
              phone={lead.phone}
              leadName={`${lead.firstName} ${lead.lastName}`.trim()}
              canLog={canWrite}
              voiceProvider={org?.voiceProvider ?? null}
            />
          </section>

          <section
            aria-label="Convert lead"
            className="flex flex-col gap-3 rounded-lg border bg-card p-[18px]"
          >
            <h2 className="text-sm font-semibold">Convert</h2>
            {canWrite ? (
              <LeadConvert
                leadId={lead.id}
                alreadyConverted={alreadyConverted}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                You don&apos;t have permission to convert leads.
              </p>
            )}
          </section>

          {hasPermission(session.dbUser, 'leads:read') && (
            <section
              aria-label="Duplicate detection"
              className="flex flex-col gap-3 rounded-lg border bg-card p-[18px]"
            >
              <h2 className="text-sm font-semibold">Duplicates</h2>
              <DuplicateCheck
                leadId={lead.id}
                organizationId={session.organizationId}
                userId={session.dbUser.id}
                canMerge={canWrite && canDelete}
              />
            </section>
          )}

          {canWrite && !canDelete && (
            <section
              aria-label="Request deletion"
              className="flex flex-col gap-3 rounded-lg border border-danger/20 bg-card p-[18px]"
            >
              <h2 className="text-sm font-semibold text-danger-foreground">
                Danger Zone
              </h2>
              <DeletionRequestButton
                leadId={lead.id}
                leadName={`${lead.firstName} ${lead.lastName}`.trim()}
              />
            </section>
          )}
        </aside>
      </div>
    </div>
  )
}

/**
 * Normalises a Prisma Activity row into the JSON-serializable shape
 * expected by the activity timeline client component. Dates are converted
 * to ISO strings so the initial cache matches the `/api/activities/[leadId]`
 * payload byte-for-byte.
 */
function toActivityItem(
  activity: Awaited<ReturnType<typeof getActivitiesByLead>>[number],
): ActivityItem {
  return {
    id: activity.id,
    type: activity.type as ActivityItem['type'],
    leadId: activity.leadId,
    createdById: activity.createdById,
    notes: activity.notes,
    callDate: activity.callDate ? activity.callDate.toISOString() : null,
    callDuration: activity.callDuration,
    meetingDate: activity.meetingDate
      ? activity.meetingDate.toISOString()
      : null,
    attendees: activity.attendees,
    emailMessageId: activity.emailMessageId,
    createdAt: activity.createdAt.toISOString(),
  }
}
