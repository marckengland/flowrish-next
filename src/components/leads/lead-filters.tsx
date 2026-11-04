'use client'

import { useEffect, useId, useLayoutEffect, useState } from 'react'
import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input, inputBaseClass } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useFiltersStore, type LeadFilterKey } from '@/stores/filters'

/**
 * Minimal shape accepted for filter options. The leads page resolves these
 * values from Server Components (stages from Pipeline service, assignees
 * from Organization members) and passes them down as props so the filter
 * panel itself remains dumb and reusable.
 */
export interface FilterOption {
  value: string
  label: string
}

export interface LeadFiltersProps {
  /** Pipeline stages available in the current organization. */
  stages?: readonly FilterOption[]
  /** Users in the current organization eligible for assignment. */
  assignees?: readonly FilterOption[]
  className?: string
  storageKey?: string
  onReadyChange?: (ready: boolean) => void
}

const LEADS_FILTERS_KEY = 'flowrish:leads:filters'

const STATUS_OPTIONS: readonly FilterOption[] = [
  { value: 'NEW', label: 'New' },
  { value: 'CONTACTED', label: 'Contacted' },
  { value: 'QUALIFIED', label: 'Qualified' },
  { value: 'UNQUALIFIED', label: 'Unqualified' },
  { value: 'NURTURING', label: 'Nurturing' },
]

const TIER_OPTIONS: readonly FilterOption[] = [
  { value: 'TIER_1', label: 'Tier 1' },
  { value: 'TIER_2', label: 'Tier 2' },
  { value: 'TIER_3', label: 'Tier 3' },
]

/**
 * Filter panel for the Leads list page.
 *
 * Wired to the Zustand `filters` store so any other component on the page
 * (table header, saved-view menu) can observe and manipulate the same
 * filter state without prop-drilling. Filter options for stages and
 * assignees are provided by the parent (resolved server-side) — this
 * component does not fetch them itself.
 *
 * Search input is debounced locally so keystrokes don't fire a network
 * request on every character; the debounced value is what actually gets
 * written into the shared filter store.
 *
 * Validates: Requirements 4.4, 4.6, 26.4
 */
export function LeadFilters({
  stages = [],
  assignees = [],
  className,
  storageKey = LEADS_FILTERS_KEY,
  onReadyChange,
}: LeadFiltersProps): React.JSX.Element {
  const leads = useFiltersStore((s) => s.leads)
  const setLeadFilter = useFiltersStore((s) => s.setLeadFilter)
  const setLeadFilters = useFiltersStore((s) => s.setLeadFilters)
  const resetLeadFilters = useFiltersStore((s) => s.resetLeadFilters)

  // Persist the active filter set to localStorage so it survives navigation
  // and reloads. Loaded once after mount (SSR-safe — the server renders with
  // no filters, the client hydrates them), then written on every change.
  const [filtersHydrated, setFiltersHydrated] = useState(false)
  const [searchInput, setSearchInput] = useState(leads.search ?? '')
  const debouncedSearch = useDebouncedValue(searchInput, 300)
  useEffect(() => {
    if (storageKey !== LEADS_FILTERS_KEY) {
      setLeadFilters({})
      setSearchInput('')
    }
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>
        if (
          parsed &&
          typeof parsed === 'object' &&
          Object.keys(parsed).length > 0
        ) {
          setLeadFilters(parsed)
          setSearchInput(typeof parsed.search === 'string' ? parsed.search : '')
        }
      }
    } catch {
      // Ignore malformed / unavailable storage.
    } finally {
      setFiltersHydrated(true)
    }
  }, [setLeadFilters, storageKey])

  useEffect(() => {
    if (!filtersHydrated) return
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(leads))
    } catch {
      // Ignore quota / unavailable storage.
    }
  }, [leads, filtersHydrated, storageKey])

  useLayoutEffect(() => {
    onReadyChange?.(filtersHydrated && debouncedSearch === searchInput && (leads.search ?? '') === searchInput.trim())
  }, [filtersHydrated, debouncedSearch, searchInput, leads.search, onReadyChange])

  const searchId = useId()
  const stageId = useId()
  const statusId = useId()
  const tierId = useId()
  const assigneeId = useId()

  // Local input state keeps the field responsive while the query key is
  // debounced. Seeded from the store so external "clear" actions still
  // reset the visible input.
  useEffect(() => {
    if (!filtersHydrated || debouncedSearch !== searchInput) return
    setLeadFilter('search', debouncedSearch)
  }, [debouncedSearch, searchInput, filtersHydrated, setLeadFilter])

  useEffect(() => {
    // Reflect external resets in the local input (e.g. Clear button).
    if ((leads.search ?? '') !== searchInput) {
      setSearchInput(leads.search ?? '')
    }
    // Intentionally only react to store changes, not local edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads.search])

  const hasActiveFilters = Object.keys(leads).length > 0

  return (
    <section
      aria-label="Lead filters"
      className={cn(
        'flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:flex-wrap sm:items-end',
        className,
      )}
    >
      <Field id={searchId} label="Search">
        <Input
          id={searchId}
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Name, email, or company…"
          className="h-8"
        />
      </Field>

      <Field id={stageId} label="Stage">
        <SelectInput
          id={stageId}
          value={leads.stageId ?? ''}
          onChange={(v) => setLeadFilter('stageId', v)}
          placeholder="All stages"
          options={stages}
        />
      </Field>

      <Field id={statusId} label="Status">
        <SelectInput
          id={statusId}
          value={leads.leadStatus ?? ''}
          onChange={(v) => setLeadFilter('leadStatus', v)}
          placeholder="All statuses"
          options={STATUS_OPTIONS}
        />
      </Field>

      <Field id={tierId} label="Tier">
        <SelectInput
          id={tierId}
          value={leads.tier ?? ''}
          onChange={(v) => setLeadFilter('tier', v)}
          placeholder="All tiers"
          options={TIER_OPTIONS}
        />
      </Field>

      <Field id={assigneeId} label="Assignee">
        <SelectInput
          id={assigneeId}
          value={leads.assignedUserId ?? ''}
          onChange={(v) => setLeadFilter('assignedUserId', v)}
          placeholder="Anyone"
          options={assignees}
        />
      </Field>

      <div className="sm:ml-auto">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!hasActiveFilters}
          onClick={() => {
            resetLeadFilters()
            setSearchInput('')
          }}
          aria-label="Clear all filters"
        >
          <X className="size-4" aria-hidden="true" />
          <span>Clear</span>
        </Button>
      </div>
    </section>
  )
}

/**
 * Field wrapper that pairs a `<label>` with a control so screen readers
 * announce the filter name and for/id association keeps the control
 * focusable by label click.
 */
function Field({
  id,
  label,
  children,
}: {
  id: string
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-[14rem]">
      <label htmlFor={id} className="eyebrow">
        {label}
      </label>
      {children}
    </div>
  )
}

/**
 * Wrapper around a native `<select>` that always renders an empty-label
 * "All X" option at the top. Uses the shared input classes so the
 * visual treatment matches the surrounding text inputs.
 */
function SelectInput({
  id,
  value,
  onChange,
  placeholder,
  options,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  options: readonly FilterOption[]
}): React.JSX.Element {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(inputBaseClass, 'h-8')}
    >
      <option value="">{placeholder}</option>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}

// Re-export for parents that want to type-guard filter keys.
export type { LeadFilterKey }
