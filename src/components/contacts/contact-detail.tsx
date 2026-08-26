'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Briefcase,
  Building2,
  ExternalLink,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Trash2,
  TrendingUp,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useDeleteContactMutation } from '@/hooks/use-contacts'
import { toast } from '@/lib/toast'

export interface ContactDetailLead {
  id: string
  firstName: string
  lastName: string
}

export interface ContactDetailViewProps {
  contact: {
    id: string
    firstName: string
    lastName: string
    email: string | null
    phone: string | null
    jobTitle: string | null
    linkedinUrl: string | null
    country: string | null
    state: string | null
    company: { id: string; name: string } | null
  }
  /** Leads this contact is linked to (via the LeadContact join table). */
  leads: readonly ContactDetailLead[]
  canManage: boolean
}

/**
 * Read-only contact detail surface.
 *
 * Mirrors the company detail layout: header with quick-facts, then
 * sections for the linked company and any associated leads. Edit lives
 * on the contacts list inline form, so this surface stays read-only;
 * delete is offered when the user has `contacts:write`.
 *
 * Validates: Requirement 19.1
 */
export function ContactDetailView({
  contact,
  leads,
  canManage,
}: ContactDetailViewProps): React.JSX.Element {
  const router = useRouter()
  const deleteMutation = useDeleteContactMutation()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const fullName = `${contact.firstName} ${contact.lastName}`.trim()

  async function confirmDelete(): Promise<void> {
    try {
      await deleteMutation.mutateAsync(contact.id)
      toast.success(`Deleted ${fullName}`)
      router.push('/contacts')
    } catch (err) {
      toast.error("Couldn't delete contact", {
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <nav className="text-sm">
        <Link
          href="/contacts"
          className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <span aria-hidden="true">←</span>
          <span>Back to contacts</span>
        </Link>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold leading-tight tracking-[-0.02em]">
            {fullName}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            {contact.jobTitle ? (
              <span className="flex items-center gap-1">
                <Briefcase className="size-3.5" aria-hidden="true" />
                {contact.jobTitle}
              </span>
            ) : null}
            {contact.company ? (
              <Link
                href={`/companies/${contact.company.id}`}
                className="flex items-center gap-1 hover:text-foreground hover:underline"
              >
                <Building2 className="size-3.5" aria-hidden="true" />
                {contact.company.name}
              </Link>
            ) : null}
            {contact.country || contact.state ? (
              <span className="flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden="true" />
                {[contact.state, contact.country].filter(Boolean).join(', ')}
              </span>
            ) : null}
          </div>
        </div>

        {canManage ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => setConfirmOpen(true)}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                <span>Deleting…</span>
              </>
            ) : (
              <>
                <Trash2 className="size-3.5" aria-hidden="true" />
                <span>Delete</span>
              </>
            )}
          </Button>
        ) : null}
      </header>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={confirmDelete}
        tone="danger"
        title="Delete contact"
        description={`Delete "${fullName}"? This cannot be undone.`}
        confirmLabel="Delete"
      />

      <section
        aria-labelledby="contact-info"
        className="rounded-lg border bg-card"
      >
        <h2 id="contact-info" className="sr-only">
          Contact information
        </h2>
        <dl className="divide-y divide-row-divider text-sm">
          <DetailRow icon={Mail} label="Email">
            {contact.email ? (
              <a
                href={`mailto:${contact.email}`}
                className="text-brand-emphasis hover:underline"
              >
                {contact.email}
              </a>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </DetailRow>
          <DetailRow icon={Phone} label="Phone">
            {contact.phone ? (
              <a
                href={`tel:${contact.phone}`}
                className="text-brand-emphasis hover:underline"
              >
                {contact.phone}
              </a>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </DetailRow>
          <DetailRow icon={ExternalLink} label="LinkedIn">
            {contact.linkedinUrl ? (
              <a
                href={normalizeUrl(contact.linkedinUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-emphasis hover:underline"
              >
                {contact.linkedinUrl}
              </a>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </DetailRow>
        </dl>
      </section>

      <section aria-labelledby="contact-leads">
        <h2
          id="contact-leads"
          className="mb-2 flex items-center gap-2 text-sm font-semibold"
        >
          <TrendingUp className="size-4" aria-hidden="true" />
          Linked leads ({leads.length})
        </h2>
        {leads.length === 0 ? (
          <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
            This contact isn’t linked to any leads yet.
          </p>
        ) : (
          <ul className="divide-y divide-row-divider rounded-lg border bg-card">
            {leads.map((lead) => (
              <li key={lead.id}>
                <Link
                  href={`/leads/${lead.id}`}
                  className="flex items-center justify-between px-4 py-2.5 text-sm transition-colors hover:bg-background"
                >
                  <span className="font-medium">
                    {lead.firstName} {lead.lastName}
                  </span>
                  <span className="text-xs text-muted-foreground">View →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

interface DetailRowProps {
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  label: string
  children: React.ReactNode
}

function DetailRow({ icon: Icon, label, children }: DetailRowProps) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] items-center gap-3 px-4 py-2.5">
      <dt className="eyebrow flex items-center gap-2">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

function normalizeUrl(input: string): string {
  return /^https?:\/\//i.test(input) ? input : `https://${input}`
}
