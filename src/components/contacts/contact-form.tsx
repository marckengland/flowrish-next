'use client'

import { useActionState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, SelectField } from '@/components/ui/field'
import { createContact, updateContact } from '@/server/actions/contacts'
import { toast } from '@/lib/toast'

/**
 * Company option for the company select dropdown.
 */
export interface ContactFormCompany {
  id: string
  name: string
}

/**
 * Existing contact shape accepted when the form is used in edit mode.
 */
export interface ContactFormValues {
  id: string
  firstName: string
  lastName: string
  email?: string | null
  phone?: string | null
  jobTitle?: string | null
  linkedinUrl?: string | null
  country?: string | null
  state?: string | null
  companyId?: string | null
}

export interface ContactFormProps {
  /** Companies available in the organization for linking. */
  companies?: readonly ContactFormCompany[]
  /** Provide a contact to render the form in edit mode; omit for create mode. */
  contact?: ContactFormValues | null
  /** Optional callback invoked after a successful create/update. */
  onSuccess?: (contactId: string) => void
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
 * Zod-validated create/edit form for contacts.
 *
 * Validates: Requirement 19.1
 */
export function ContactForm({
  companies = [],
  contact,
  onSuccess,
  onCancel,
  submitLabel,
}: ContactFormProps): React.JSX.Element {
  const isEditing = Boolean(contact?.id)

  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    async (_prev, formData) => {
      const result = isEditing
        ? await updateContact(formData)
        : await createContact(formData)

      if (result && 'data' in result && result.data) {
        toast.success(isEditing ? 'Contact updated' : 'Contact created')
        onSuccess?.(result.data.id)
      }
      return result as ActionResult
    },
    null,
  )

  const resolvedSubmitLabel =
    submitLabel ?? (isEditing ? 'Save Changes' : 'Create Contact')
  const pendingLabel = isEditing ? 'Saving…' : 'Creating…'

  return (
    <form action={formAction} className="space-y-4" aria-busy={pending || undefined}>
      {isEditing && contact?.id ? (
        <input type="hidden" name="id" value={contact.id} />
      ) : null}

      {/* Name row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          id="contact-first-name"
          name="firstName"
          error={state?.fieldErrors?.firstName}
          label="First Name"
          required
          defaultValue={contact?.firstName ?? ''}
          autoComplete="given-name"
          placeholder="First name"
        />
        <Field
          id="contact-last-name"
          name="lastName"
          error={state?.fieldErrors?.lastName}
          label="Last Name"
          required
          defaultValue={contact?.lastName ?? ''}
          autoComplete="family-name"
          placeholder="Last name"
        />
      </div>

      {/* Email & phone */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          id="contact-email"
          name="email"
          error={state?.fieldErrors?.email}
          label="Email"
          type="email"
          autoComplete="email"
          defaultValue={contact?.email ?? ''}
          placeholder="email@example.com"
        />
        <Field
          id="contact-phone"
          name="phone"
          error={state?.fieldErrors?.phone}
          label="Phone"
          type="tel"
          autoComplete="tel"
          defaultValue={contact?.phone ?? ''}
          placeholder="+1 (555) 000-0000"
        />
      </div>

      {/* Job title & company */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          id="contact-job-title"
          name="jobTitle"
          error={state?.fieldErrors?.jobTitle}
          label="Job Title"
          defaultValue={contact?.jobTitle ?? ''}
          placeholder="e.g. VP of Sales"
        />
        <SelectField
          id="contact-company"
          name="companyId"
          error={state?.fieldErrors?.companyId}
          label="Company"
          defaultValue={contact?.companyId ?? ''}
        >
          <option value="">No company</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
      </div>

      {/* LinkedIn */}
      <Field
        id="contact-linkedin"
        name="linkedinUrl"
        error={state?.fieldErrors?.linkedinUrl}
        label="LinkedIn URL"
        type="url"
        defaultValue={contact?.linkedinUrl ?? ''}
        placeholder="https://linkedin.com/in/..."
      />

      {/* Location */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          id="contact-country"
          name="country"
          error={state?.fieldErrors?.country}
          label="Country"
          autoComplete="country-name"
          defaultValue={contact?.country ?? ''}
          placeholder="e.g. United States"
        />
        <Field
          id="contact-state"
          name="state"
          error={state?.fieldErrors?.state}
          label="State / Region"
          autoComplete="address-level1"
          defaultValue={contact?.state ?? ''}
          placeholder="e.g. California"
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


