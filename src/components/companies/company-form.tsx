'use client'

import { useActionState } from 'react'

import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { createCompany, updateCompany } from '@/server/actions/contacts'
import { toast } from '@/lib/toast'

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

type ActionResult = {
  error?: string
  fieldErrors?: Record<string, string>
  data?: { id: string }
} | null

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
        toast.success(isEditing ? 'Company updated' : 'Company created')
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
        error={state?.fieldErrors?.name}
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
          error={state?.fieldErrors?.industry}
          label="Industry"
          defaultValue={company?.industry ?? ''}
          placeholder="e.g. Software / SaaS"
        />
        <Field
          id="company-website"
          name="website"
          error={state?.fieldErrors?.website}
          label="Website"
          type="url"
          defaultValue={company?.website ?? ''}
          placeholder="https://example.com"
        />
      </div>

      {state?.error ? (
        <p role="alert" className="text-sm text-danger-foreground">
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
