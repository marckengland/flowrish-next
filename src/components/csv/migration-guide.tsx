'use client'

import { useState } from 'react'
import { ArrowDown, Cloud, Check } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'

/**
 * Self-serve migration guide for teams moving from another CRM.
 *
 * Renders provider-specific, step-by-step export instructions (no tech
 * support required) plus a column-mapping cheat sheet. The actual data
 * import is handled by the existing CSV import wizard below it — Flowrish
 * auto-detects the standard Salesforce / HubSpot / Pipedrive column names,
 * so most migrations need zero manual mapping.
 */

interface Provider {
  id: string
  name: string
  /** One-line summary of what the export produces. */
  summary: string
  /** Ordered, self-contained export steps. */
  steps: string[]
}

const PROVIDERS: readonly Provider[] = [
  {
    id: 'salesforce',
    name: 'Salesforce',
    summary: 'Export Leads (and Contacts/Accounts) to CSV, then upload below.',
    steps: [
      'Click the gear icon (top right) → Setup.',
      'In the Quick Find box, type “Data Export”, then open Data → Data Export.',
      'Click “Export Now”, tick Leads (also Contacts and Accounts if you want them), choose CSV, and start the export.',
      'Salesforce emails you a .zip when it’s ready — download and unzip it to get the CSV files.',
      'Tip for a quicker single-object export: open the Leads tab → pick a List View → row-menu → “Export”, or build a Report on Leads and use “Export → .csv”.',
      'Upload the Leads (or Contacts) CSV in the importer below. Flowrish auto-maps First Name, Last Name, Email, Company, Phone and Title.',
    ],
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    summary: 'Export Contacts (or Deals) to CSV, then upload below.',
    steps: [
      'Go to CRM → Contacts (or Sales → Deals).',
      'Click “Export” at the top of the table.',
      'Choose “All columns” — or pick First name, Last name, Email, Phone, Company name and Job title — and select CSV as the format.',
      'Click Export. HubSpot emails a download link (also under the notifications bell).',
      'Download the CSV and upload it in the importer below. HubSpot’s standard property names map automatically.',
    ],
  },
  {
    id: 'pipedrive',
    name: 'Pipedrive',
    summary: 'Export Persons (and Organizations) to CSV, then upload below.',
    steps: [
      'Open “...” (More) in the top bar → “Export data”, or go to Settings → Export data.',
      'Select “Persons” (add “Organizations” / “Deals” if you need them) and choose the CSV format.',
      'Run the export, then download the file from the export list when it finishes.',
      'Upload the Persons CSV in the importer below and confirm the column mapping.',
    ],
  },
  {
    id: 'other',
    name: 'Other CRM',
    summary: 'Any CRM that can export a CSV with a header row works.',
    steps: [
      'Export your contacts / leads from your current tool as a CSV file that includes a header row.',
      'Make sure there are at least First Name and Last Name columns — everything else is optional.',
      'Upload the file in the importer below.',
      'Anything Flowrish didn’t auto-detect, map by hand on the mapping step — it takes a few seconds.',
    ],
  },
]

const MAPPING_CHEATSHEET: ReadonlyArray<{ from: string; to: string; required?: boolean }> = [
  { from: 'First Name · Given Name · FName', to: 'First name', required: true },
  { from: 'Last Name · Surname · LName', to: 'Last name', required: true },
  { from: 'Email · Work Email', to: 'Email' },
  { from: 'Phone · Mobile · Mobile Phone', to: 'Phone' },
  { from: 'Company · Account · Organization', to: 'Company (auto-created)' },
  { from: 'Job Title · Title · Position', to: 'Title' },
  { from: 'Website · Domain', to: 'Company website' },
  { from: 'Industry', to: 'Company industry' },
  { from: 'Amount · Deal Value · Opportunity Amount', to: 'Deal value' },
  { from: 'LinkedIn · LinkedIn URL', to: 'LinkedIn URL' },
]

export function MigrationGuide(): React.JSX.Element {
  const [providerId, setProviderId] = useState<string>('salesforce')
  const provider = PROVIDERS.find((p) => p.id === providerId) ?? PROVIDERS[0]!

  return (
    <Card>
      <CardContent className="flex flex-col gap-5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-brand-subtle text-brand-emphasis"
          >
            <Cloud className="size-[18px]" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Migrating from another CRM?
            </h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Export your data as CSV from your current tool, then import it
              below. No engineering or support ticket needed — Flowrish
              auto-detects the standard column names.
            </p>
          </div>
        </div>

        {/* Provider selector */}
        <div
          role="tablist"
          aria-label="Choose your current CRM"
          className="flex flex-wrap gap-2"
        >
          {PROVIDERS.map((p) => {
            const active = p.id === provider.id
            return (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setProviderId(p.id)}
                className={cn(
                  'rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors',
                  active
                    ? 'border-brand bg-brand-subtle text-brand-emphasis'
                    : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {p.name}
              </button>
            )
          })}
        </div>

        {/* Steps */}
        <div>
          <p className="mb-3 text-[13px] text-muted-foreground">{provider.summary}</p>
          <ol className="flex flex-col gap-2.5">
            {provider.steps.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex size-[22px] shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[11px] font-semibold tnum text-foreground"
                >
                  {i + 1}
                </span>
                <span className="text-[13.5px] leading-[1.5] text-foreground/80">
                  {step}
                </span>
              </li>
            ))}
          </ol>
        </div>

        {/* Mapping cheat sheet */}
        <details className="rounded-[10px] border bg-background/60">
          <summary className="cursor-pointer px-4 py-2.5 text-[13px] font-medium text-foreground">
            Column mapping cheat sheet
          </summary>
          <div className="border-t px-1 pb-1">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-row-divider">
                  <th className="eyebrow px-3 py-2 text-left">Your column</th>
                  <th className="eyebrow px-3 py-2 text-left">Flowrish field</th>
                </tr>
              </thead>
              <tbody>
                {MAPPING_CHEATSHEET.map((m) => (
                  <tr key={m.to} className="border-b border-row-divider last:border-0">
                    <td className="px-3 py-2 font-mono text-muted-foreground">{m.from}</td>
                    <td className="px-3 py-2 font-medium text-foreground">
                      {m.to}
                      {m.required && (
                        <span className="ml-1.5 text-danger-foreground">required</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>

        {/* What comes over */}
        <ul className="flex flex-col gap-1.5 text-[12.5px] text-muted-foreground">
          {[
            'Companies are created automatically from the Company / Account column.',
            'A contact is linked to each lead when an email address is present.',
            'Duplicate rows (matching an existing email) are skipped, so re-running an import is safe.',
          ].map((t) => (
            <li key={t} className="flex gap-2">
              <Check className="mt-0.5 size-3.5 shrink-0 text-brand-emphasis" aria-hidden="true" />
              {t}
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2 rounded-[10px] bg-brand-subtle/50 px-3.5 py-2.5 text-[13px] font-medium text-brand-emphasis">
          <ArrowDown className="size-4 shrink-0" aria-hidden="true" />
          When your CSV is ready, upload it in the importer below.
        </div>
      </CardContent>
    </Card>
  )
}
