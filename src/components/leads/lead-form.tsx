'use client'

import { useActionState, useMemo } from 'react'

import { Button } from '@/components/ui/button'
import { Field, SelectField } from '@/components/ui/field'
import { createLead, updateLead } from '@/server/actions/leads'
import { toast } from '@/lib/toast'

/**
 * Minimal pipeline stage shape consumed by the form.
 * Page-level Server Components pass the already-loaded stages in.
 */
export interface LeadFormStage {
  id: string
  name: string
  order: number
}

/**
 * Existing lead shape accepted when the form is used in edit mode. Any fields
 * omitted from `lead` simply render as empty. Values are rendered through
 * `defaultValue`, so the form remains uncontrolled — it lets the browser own
 * the input state and the server action own validation/persistence.
 */
export interface LeadFormValues {
  id: string
  firstName: string
  lastName: string
  stageId: string
  email?: string | null
  altEmail?: string | null
  phone?: string | null
  title?: string | null
  description?: string | null
  dealValue?: number | string | null
  currency?: string | null
  score?: number | null
  leadStatus?: string | null
  tier?: string | null
  linkedinUrl?: string | null
  country?: string | null
  state?: string | null
  companyName?: string | null
  companyIndustry?: string | null
  companyWebsite?: string | null
  companyLinkedinUrl?: string | null
}

export interface LeadFormProps {
  /** Stages available in the organization's default pipeline. */
  stages: readonly LeadFormStage[]
  /** Provide a lead to render the form in edit mode; omit for create mode. */
  lead?: LeadFormValues | null
  /** Optional callback invoked after a successful create/update. */
  onSuccess?: (leadId: string) => void
  /** Optional cancel handler — renders a Cancel button when provided. */
  onCancel?: () => void
  /** Override the submit label (defaults to Create Lead / Save Changes). */
  submitLabel?: string
}

/**
 * Matches the Zod `leadStatusEnum` in `src/lib/validators/leads.ts`.
 * Keeping this list inline (rather than importing) avoids pulling the Zod
 * module into the client bundle just for an options list.
 */
const LEAD_STATUS_OPTIONS = [
  { value: 'NEW', label: 'New' },
  { value: 'CONTACTED', label: 'Contacted' },
  { value: 'QUALIFIED', label: 'Qualified' },
  { value: 'UNQUALIFIED', label: 'Unqualified' },
  { value: 'NURTURING', label: 'Nurturing' },
] as const

/**
 * Matches the Zod `leadTierEnum` in `src/lib/validators/leads.ts`.
 */
const TIER_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'TIER_1', label: 'Tier 1' },
  { value: 'TIER_2', label: 'Tier 2' },
  { value: 'TIER_3', label: 'Tier 3' },
] as const

type ActionResult = {
  error?: string
  fieldErrors?: Record<string, string>
  data?: { id: string }
} | null

/**
 * Zod-validated create/edit form for leads.
 *
 * - Renders every Lead field covered by the create/update Zod schemas
 * - Submits through React 19 `useActionState` to the `createLead` /
 *   `updateLead` Server Actions so validation and audit logging run on the
 *   server (Requirement 4.1, 4.2)
 * - In edit mode the lead `id` is sent as a hidden field, matching what
 *   `updateLead` expects from its FormData
 * - Displays the first validation error surfaced by the server action
 *
 * Validates: Requirements 4.1, 4.2, 4.6
 */
export function LeadForm({
  stages,
  lead,
  onSuccess,
  onCancel,
  submitLabel,
}: LeadFormProps): React.JSX.Element {
  const isEditing = Boolean(lead?.id)

  // Sort stages by `order` defensively — the server guarantees contiguous
  // integers starting at 1 but we don't want to rely on call-site ordering.
  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.order - b.order),
    [stages],
  )

  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    async (_prev, formData) => {
      const result = isEditing
        ? await updateLead(formData)
        : await createLead(formData)

      if (result && 'data' in result && result.data) {
        toast.success(isEditing ? 'Lead updated' : 'Lead created')
        onSuccess?.(result.data.id)
      }
      return result as ActionResult
    },
    null,
  )

  const defaultStageId =
    lead?.stageId ?? sortedStages[0]?.id ?? ''

  const resolvedSubmitLabel =
    submitLabel ?? (isEditing ? 'Save Changes' : 'Create Lead')

  const pendingLabel = isEditing ? 'Saving…' : 'Creating…'

  return (
    <form
      action={formAction}
      className="space-y-4"
      aria-busy={pending || undefined}
    >
      {isEditing && lead?.id ? (
        <input type="hidden" name="id" value={lead.id} />
      ) : null}

      {/* Name row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          id="lead-first-name"
          name="firstName"
          error={state?.fieldErrors?.firstName}
          label="First Name"
          required
          defaultValue={lead?.firstName ?? ''}
          autoComplete="given-name"
          placeholder="First name"
        />
        <Field
          id="lead-last-name"
          name="lastName"
          error={state?.fieldErrors?.lastName}
          label="Last Name"
          required
          defaultValue={lead?.lastName ?? ''}
          autoComplete="family-name"
          placeholder="Last name"
        />
      </div>

      {/* Title & company name */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          id="lead-title"
          name="title"
          error={state?.fieldErrors?.title}
          label="Title / Role"
          defaultValue={lead?.title ?? ''}
          placeholder="e.g. VP of Sales"
        />
        <Field
          id="lead-company-name"
          name="companyName"
          error={state?.fieldErrors?.companyName}
          label="Company Name"
          defaultValue={lead?.companyName ?? ''}
          placeholder="Company name"
        />
      </div>

      {/* Status / tier / stage */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SelectField
          id="lead-status"
          name="leadStatus"
          error={state?.fieldErrors?.leadStatus}
          label="Lead Status"
          defaultValue={lead?.leadStatus ?? 'NEW'}
        >
          {LEAD_STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          id="lead-tier"
          name="tier"
          error={state?.fieldErrors?.tier}
          label="Tier"
          defaultValue={lead?.tier ?? ''}
        >
          {TIER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          id="lead-stage"
          name="stageId"
          error={state?.fieldErrors?.stageId}
          label="Deal Stage"
          required
          defaultValue={defaultStageId}
        >
          {sortedStages.length === 0 ? (
            <option value="" disabled>
              No stages available
            </option>
          ) : (
            sortedStages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))
          )}
        </SelectField>
      </div>

      {/* Deal value / currency / score */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field
          id="lead-deal-value"
          name="dealValue"
          error={state?.fieldErrors?.dealValue}
          label="Deal Value"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          defaultValue={formatDecimalDefault(lead?.dealValue)}
          placeholder="0.00"
        />
        <Field
          id="lead-currency"
          name="currency"
          error={state?.fieldErrors?.currency}
          label="Currency"
          maxLength={3}
          defaultValue={lead?.currency ?? 'USD'}
          placeholder="USD"
        />
        <Field
          id="lead-score"
          name="score"
          error={state?.fieldErrors?.score}
          label="Score (0–100)"
          type="number"
          min={0}
          max={100}
          step={1}
          defaultValue={lead?.score != null ? String(lead.score) : ''}
          placeholder="0"
        />
      </div>

      {/* LinkedIn */}
      <Field
        id="lead-linkedin"
        name="linkedinUrl"
        error={state?.fieldErrors?.linkedinUrl}
        label="LinkedIn URL"
        type="url"
        defaultValue={lead?.linkedinUrl ?? ''}
        placeholder="https://linkedin.com/in/..."
      />

      {/* Email contacts */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field
          id="lead-email"
          name="email"
          error={state?.fieldErrors?.email}
          label="Email"
          type="email"
          autoComplete="email"
          defaultValue={lead?.email ?? ''}
          placeholder="email@example.com"
        />
        <Field
          id="lead-alt-email"
          name="altEmail"
          error={state?.fieldErrors?.altEmail}
          label="Alt Email"
          type="email"
          defaultValue={lead?.altEmail ?? ''}
          placeholder="alt@example.com"
        />
        <Field
          id="lead-phone"
          name="phone"
          error={state?.fieldErrors?.phone}
          label="Phone"
          type="tel"
          autoComplete="tel"
          defaultValue={lead?.phone ?? ''}
          placeholder="+1 (555) 000-0000"
        />
      </div>

      {/* Location */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          id="lead-country"
          name="country"
          error={state?.fieldErrors?.country}
          label="Country"
          autoComplete="country-name"
          defaultValue={lead?.country ?? ''}
          placeholder="e.g. United States"
        />
        <Field
          id="lead-state"
          name="state"
          error={state?.fieldErrors?.state}
          label="State / Region"
          autoComplete="address-level1"
          defaultValue={lead?.state ?? ''}
          placeholder="e.g. California"
        />
      </div>

      {/* Company details */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          id="lead-company-industry"
          name="companyIndustry"
          error={state?.fieldErrors?.companyIndustry}
          label="Company Industry"
          defaultValue={lead?.companyIndustry ?? ''}
          placeholder="e.g. Software / SaaS"
        />
        <Field
          id="lead-company-website"
          name="companyWebsite"
          error={state?.fieldErrors?.companyWebsite}
          label="Company Website"
          type="url"
          defaultValue={lead?.companyWebsite ?? ''}
          placeholder="https://example.com"
        />
        <Field
          id="lead-company-linkedin"
          name="companyLinkedinUrl"
          error={state?.fieldErrors?.companyLinkedinUrl}
          label="Company LinkedIn URL"
          type="url"
          defaultValue={lead?.companyLinkedinUrl ?? ''}
          placeholder="https://linkedin.com/company/..."
        />
      </div>

      {/* Description */}
      <div>
        <label
          htmlFor="lead-description"
          className="block text-sm font-medium text-foreground mb-1.5"
        >
          Description
        </label>
        <textarea
          id="lead-description"
          name="description"
          rows={3}
          defaultValue={lead?.description ?? ''}
          placeholder="Optional notes about this lead"
          className="w-full rounded-[10px] border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm transition-[color,box-shadow,border-color] placeholder:text-muted-foreground focus-visible:border-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/15 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      {state?.error ? (
        <p role="alert" className="text-sm text-danger-foreground">
          {state.error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </Button>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? pendingLabel : resolvedSubmitLabel}
        </Button>
      </div>
    </form>
  )
}

// ─── Private helpers ────────────────────────────────────────────────────────

/**
 * Prisma returns `dealValue` as a Decimal (serialized to string over the wire
 * or Decimal instance in-process). Normalise to a plain number string for the
 * number input's `defaultValue` without losing precision for typical amounts.
 */
function formatDecimalDefault(
  value: number | string | null | undefined,
): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : ''
  }
  return value
}
