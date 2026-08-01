'use client'

import { useCallback, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface SearchBarProps {
  /** Initial query value (e.g. from URL search params). */
  defaultValue?: string
  /** Placeholder text shown when the input is empty. */
  placeholder?: string
  /** Additional class names for the root wrapper. */
  className?: string
  /**
   * If true, the search bar navigates to `/search?q=…` on submit.
   * If false, it calls `onSearch` instead (for inline usage).
   * Defaults to true.
   */
  navigateOnSubmit?: boolean
  /** Callback fired on submit when `navigateOnSubmit` is false. */
  onSearch?: (query: string) => void
}

/**
 * Global search input component.
 *
 * Renders a form with a text input and submit button. On submit it either
 * navigates to the `/search` page with the query as a URL param (default
 * behavior for the header/sidebar) or invokes a callback for inline usage.
 *
 * Accessibility:
 * - Uses a `<form>` with `role="search"` for landmark semantics
 * - Associates the input with a label via `aria-label`
 * - Clear button is only visible when the input has content
 *
 * Validates: Requirements 12.2, 12.4
 */
export function SearchBar({
  defaultValue = '',
  placeholder = 'Search leads, contacts, companies…',
  className,
  navigateOnSubmit = true,
  onSearch,
}: SearchBarProps): React.JSX.Element {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const [value, setValue] = useState(defaultValue)

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      const trimmed = value.trim()
      if (!trimmed) return

      if (navigateOnSubmit) {
        const params = new URLSearchParams({ q: trimmed })
        router.push(`/search?${params.toString()}`)
      } else {
        onSearch?.(trimmed)
      }
    },
    [value, navigateOnSubmit, onSearch, router],
  )

  const handleClear = useCallback(() => {
    setValue('')
    inputRef.current?.focus()
  }, [])

  return (
    <form
      role="search"
      aria-label="Search across all entities"
      onSubmit={handleSubmit}
      className={cn('relative flex w-full items-center', className)}
    >
      <label htmlFor={inputId} className="sr-only">
        Search
      </label>
      <div className="relative w-full">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 size-[17px] -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          name="q"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          className={cn(
            'h-[46px] w-full rounded-xl border border-input bg-card pl-11 pr-10 text-[15px] text-foreground outline-none transition-[color,box-shadow,border-color]',
            'placeholder:text-muted-foreground',
            'focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand/15',
          )}
        />
        {value.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={handleClear}
            aria-label="Clear search"
            className="absolute right-1.5 top-1/2 -translate-y-1/2"
          >
            <X className="size-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>
    </form>
  )
}
