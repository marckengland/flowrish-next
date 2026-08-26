'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Factory,
  Globe,
  Pencil,
  Trash2,
  TrendingUp,
  Users,
  X,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CompanyForm } from '@/components/companies/company-form'
import { DeleteCompanyDialog } from '@/components/companies/delete-company-dialog'

export interface CompanyDetailContact {
  id: string
  firstName: string
  lastName: string
  email: string | null
  jobTitle: string | null
}

export interface CompanyDetailLead {
  id: string
  firstName: string
  lastName: string
  dealValue: number | null
  currency: string | null
  stage: { id: string; name: string } | null
}

export interface CompanyDetailViewProps {
  company: {
    id: string
    name: string
    industry: string | null
    website: string | null
  }
  contacts: readonly CompanyDetailContact[]
  leads: readonly CompanyDetailLead[]
  /** Total lead count even if `leads` was capped server-side. */
  leadCount: number
  canManage: boolean
}

/**
 * Read-only company detail surface.
 *
 * Lists associated contacts and leads with deep links into both — used
 * to give reps a single-page view of every relationship a company has
 * inside the CRM. The "Delete" affordance opens a guarded confirm
 * dialog that warns when there are linked leads (those leads keep
 * existing but lose the company association).
 *
 * Edit toggles an inline `CompanyForm` so the user can update fields
 * without leaving the page; the table/companies list also offers create
 * via its own dialog.
 *
 * Validates: Requirements 19.3, 19.4
 */
export function CompanyDetailView({
  company,
  contacts,
  leads,
  leadCount,
  canManage,
}: CompanyDetailViewProps): React.JSX.Element {
  const router = useRouter()
  const [showDelete, setShowDelete] = useState(false)
  const [editing, setEditing] = useState(false)

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => router.push('/companies')}
            aria-label="Back to companies"
            title="Back"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Button>
          <div>
            <h1 className="text-[24px] font-bold leading-tight tracking-[-0.02em]">
              {company.name}
            </h1>
            <div className="mt-1 flex flex-wrap gap-3 text-sm text-muted-foreground">
              {company.industry ? (
                <span className="flex items-center gap-1">
                  <Factory className="size-3.5" aria-hidden="true" />
                  {company.industry}
                </span>
              ) : null}
              {company.website ? (
                <a
                  href={normalizeUrl(company.website)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-w-0 items-center gap-1 break-all text-brand-emphasis hover:underline"
                >
                  <Globe className="size-3.5 shrink-0" aria-hidden="true" />
                  {company.website}
                </a>
              ) : null}
            </div>
          </div>
        </div>

        {canManage ? (
          <div className="flex gap-2">
            <Button
              type="button"
              variant={editing ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => setEditing((v) => !v)}
            >
              {editing ? (
                <>
                  <X className="size-3.5" aria-hidden="true" />
                  <span>Cancel edit</span>
                </>
              ) : (
                <>
                  <Pencil className="size-3.5" aria-hidden="true" />
                  <span>Edit</span>
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setShowDelete(true)}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              <span>Delete</span>
            </Button>
          </div>
        ) : null}
      </header>

      {editing ? (
        <section
          aria-label="Edit company"
          className="rounded-lg border bg-card p-4"
        >
          <CompanyForm
            company={{
              id: company.id,
              name: company.name,
              industry: company.industry,
              website: company.website,
            }}
            onSuccess={() => {
              setEditing(false)
              router.refresh()
            }}
            onCancel={() => setEditing(false)}
          />
        </section>
      ) : null}

      <section aria-labelledby="company-contacts">
        <h2
          id="company-contacts"
          className="mb-2 flex items-center gap-2 text-sm font-semibold"
        >
          <Users className="size-4" aria-hidden="true" />
          Contacts ({contacts.length})
        </h2>
        {contacts.length === 0 ? (
          <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
            No contacts associated with this company.
          </p>
        ) : (
          <ul className="divide-y divide-row-divider rounded-lg border bg-card">
            {contacts.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between px-4 py-2.5 text-sm"
              >
                <div>
                  <span className="font-medium">
                    {c.firstName} {c.lastName}
                  </span>
                  {c.jobTitle ? (
                    <span className="ml-2 text-muted-foreground">
                      — {c.jobTitle}
                    </span>
                  ) : null}
                </div>
                {c.email ? (
                  <span className="text-xs text-muted-foreground">
                    {c.email}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="company-leads">
        <h2
          id="company-leads"
          className="mb-2 flex items-center gap-2 text-sm font-semibold"
        >
          <TrendingUp className="size-4" aria-hidden="true" />
          Leads ({leadCount})
        </h2>
        {leads.length === 0 ? (
          <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
            No leads associated with this company.
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
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {lead.stage ? (
                      <Badge variant="neutral" size="sm">
                        {lead.stage.name}
                      </Badge>
                    ) : null}
                    {lead.dealValue !== null ? (
                      <span className="tnum">
                        ${lead.dealValue.toLocaleString()}
                        {lead.currency ? (
                          <span className="ml-0.5 text-[10px] uppercase">
                            {lead.currency}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <DeleteCompanyDialog
        open={showDelete}
        onClose={() => setShowDelete(false)}
        companyId={company.id}
        companyName={company.name}
        leadCount={leadCount}
      />
    </div>
  )
}

function normalizeUrl(input: string): string {
  return /^https?:\/\//i.test(input) ? input : `https://${input}`
}
