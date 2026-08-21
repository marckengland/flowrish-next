import * as React from 'react'

import { cn } from '@/lib/utils'
import { inputBaseClass } from '@/components/ui/input'

/**
 * Labeled form-field primitives.
 *
 * Previously each form (leads, companies, …) hand-rolled its own `Field`
 * with a duplicated Tailwind string, and the heights had drifted (h-9 vs
 * h-10). These share the single `inputBaseClass` so every field matches, and
 * they add first-class support for inline, per-field errors:
 *
 *   - a `*` marker for required fields
 *   - optional `hint` text
 *   - optional `error` text wired via `aria-invalid` + `aria-describedby`,
 *     with a destructive border so the invalid field is obvious
 */

const labelClass = 'mb-1.5 block text-sm font-medium text-foreground'
const errorClass = 'mt-1 text-xs text-destructive'
const hintClass = 'mt-1 text-xs text-muted-foreground'
const invalidClass =
  'border-destructive focus-visible:border-destructive focus-visible:ring-destructive/20'

function FieldLabel({
  htmlFor,
  required,
  children,
}: {
  htmlFor: string
  required?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <label htmlFor={htmlFor} className={labelClass}>
      {children}
      {required ? <span className="text-destructive"> *</span> : null}
    </label>
  )
}

export type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  id: string
  name: string
  label: string
  /** Supporting helper text shown below the input when there is no error. */
  hint?: string
  /** Inline validation error; sets aria-invalid and a destructive border. */
  error?: string
}

export function Field({
  id,
  name,
  label,
  required,
  hint,
  error,
  className,
  ...rest
}: FieldProps): React.JSX.Element {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  return (
    <div>
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      <input
        id={id}
        name={name}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={cn(errorId, hintId) || undefined}
        className={cn(inputBaseClass, error && invalidClass, className)}
        {...rest}
      />
      {hint && !error ? (
        <p id={hintId} className={hintClass}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className={errorClass}>
          {error}
        </p>
      ) : null}
    </div>
  )
}

export type SelectFieldProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  id: string
  name: string
  label: string
  hint?: string
  error?: string
}

export function SelectField({
  id,
  name,
  label,
  required,
  hint,
  error,
  className,
  children,
  ...rest
}: SelectFieldProps): React.JSX.Element {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  return (
    <div>
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      <select
        id={id}
        name={name}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={cn(errorId, hintId) || undefined}
        className={cn(inputBaseClass, error && invalidClass, className)}
        {...rest}
      >
        {children}
      </select>
      {hint && !error ? (
        <p id={hintId} className={hintClass}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className={errorClass}>
          {error}
        </p>
      ) : null}
    </div>
  )
}
