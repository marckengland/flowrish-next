import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Shared class string used by the `<Input>` primitive. Exported so a handful
 * of controls that can't use the primitive directly (native `<select>`,
 * `<textarea>`, third-party components) can still match the visual style.
 */
export const inputBaseClass =
  'flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

/**
 * Standard text input primitive.
 *
 * Extracted so login, onboarding, filter panels, and compose forms can
 * share the same visual treatment without copy-pasting the same long
 * Tailwind string. Any consumer that needs a variant (e.g. `type="search"`
 * with an inline icon) can still compose additional classes via `className`.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input({ className, type = 'text', ...props }, ref) {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(inputBaseClass, className)}
        {...props}
      />
    )
  },
)
