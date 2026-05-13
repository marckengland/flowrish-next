'use client'

import { useActionState } from 'react'

import { Button } from '@/components/ui/button'
import { createCompany, updateCompany } from '@/server/actions/contacts'
import { cn } from '@/lib/utils'

/**
 * Existing company shape accepted when the form is used in edit mode.
 */
export interface CompanyFormValues {
  id: string
  name: string
  industry?: string | null
  website?: string | null
}

export interface CompanyFormProps {
  /** Provide a company to render the form in edit mode; omit for create mode. */
  company?: CompanyFormValues | null
  /** Optional callback invoked after a successful create/update. */
  onSuccess?: (companyId: string) => void
  /** Optional cancel handler. */
  onCancel?: () => void
  /** Override the submit label. */
  submitLabel?: string
}

type ActionResult = { error?: string; data?: { id: string } } | null

/**
 * Zod-validated create/edit form for companies.
 *
 * Validates: Requirement 19.3
 */
export function CompanyForm({
  company,
  onSuccess,
  onCancel,
  submitLabel,
}: CompanyFormProps): React.JSX.Element {
  const isEditing = Boolean(company?.id)

  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    async (_prev, formData) => {
      const result = isEditing
        ? await updateCompany(formData)
        : await createCompany(formData)

      if (result && 'data' in result && result.data) {
        onSuccess?.(result.data.id)
      }
      return result as ActionResult
    },
    null,
  )

  const resolvedSubmitLabel =
    submitLabel ?? (isEditing ? 'Save Changes' : 'Create Company')
  const pendingLabel = isEditing ? 'Saving…' : 'Creating…'

  return (
    <form action={formAction} className="space-y-4" aria-busy={pending || undefined}>
      {isEditing && company?.id ? (
        <input type="hidden" name="id" value={company.id} />
      ) : null}

      {/* Company name */}
      <Field
        id="company-name"
        name="name"
        label="Company Name"
        required
        defaultValue={company?.name ?? ''}
        placeholder="Company name"
      />

      {/* Industry & website */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          id="company-industry"
          name="industry"
          label="Industry"
          defaultValue={company?.industry ?? ''}
          placeholder="e.g. Software / SaaS"
        />
        <Field
          id="company-website"
          name="website"
          label="Website"
          type="url"
          defaultValue={company?.website ?? ''}
          placeholder="https://example.com"
        />
      </div>

      {state?.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
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

type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  id: string
  name: string
  label: string
}

function Field({
  id,
  name,
  label,
  required,
  className,
  ...rest
}: FieldProps): React.JSX.Element {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-foreground mb-1.5">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </label>
      <input
        id={id}
        name={name}
        required={required}
        className={cn(
          'flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...rest}
      />
    </div>
  )
}
