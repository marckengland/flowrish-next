'use client'

import { useActionState } from 'react'

import { Button } from '@/components/ui/button'
import { createContact, updateContact } from '@/server/actions/contacts'
import { cn } from '@/lib/utils'

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

type ActionResult = { error?: string; data?: { id: string } } | null

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
          label="First Name"
          required
          defaultValue={contact?.firstName ?? ''}
          autoComplete="given-name"
          placeholder="First name"
        />
        <Field
          id="contact-last-name"
          name="lastName"
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
          label="Email"
          type="email"
          autoComplete="email"
          defaultValue={contact?.email ?? ''}
          placeholder="email@example.com"
        />
        <Field
          id="contact-phone"
          name="phone"
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
          label="Job Title"
          defaultValue={contact?.jobTitle ?? ''}
          placeholder="e.g. VP of Sales"
        />
        <SelectField
          id="contact-company"
          name="companyId"
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
          label="Country"
          autoComplete="country-name"
          defaultValue={contact?.country ?? ''}
          placeholder="e.g. United States"
        />
        <Field
          id="contact-state"
          name="state"
          label="State / Region"
          autoComplete="address-level1"
          defaultValue={contact?.state ?? ''}
          placeholder="e.g. California"
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

type SelectFieldProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  id: string
  name: string
  label: string
}

function SelectField({
  id,
  name,
  label,
  required,
  className,
  children,
  ...rest
}: SelectFieldProps): React.JSX.Element {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-foreground mb-1.5">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </label>
      <select
        id={id}
        name={name}
        required={required}
        className={cn(
          'flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...rest}
      >
        {children}
      </select>
    </div>
  )
}
