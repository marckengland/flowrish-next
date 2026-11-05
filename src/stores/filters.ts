import { create } from 'zustand'

/**
 * Client-side filter state for list pages (leads, tasks, cadences, etc.).
 *
 * This Zustand store replaces any Context-based filter pattern from the
 * source repo (Requirement 26.4: use Zustand for client UI state). It is a
 * module-level singleton — no provider required — so any client component
 * can subscribe directly.
 *
 * The store tracks filter inputs for the Leads listing today and is
 * structured so additional list pages can layer their own filter slices
 * without colliding. Filter values are raw strings/IDs here; the actual
 * lead query derives its Prisma `where` clause server-side from these
 * values (Requirement 2.9 — organizationId always derived server-side).
 *
 * Validates: Requirements 4.4, 4.6, 26.3, 26.4, 26.5
 */

/**
 * Filter slice for the Leads list page. Each filter is optional; undefined
 * means "not filtering on this field". An empty string in the input is
 * normalized to `undefined` on `setLeadFilter` so query keys stay stable.
 */
export interface LeadFilters {
  /** Free-text search across lead name, email, or company. */
  search?: string
  /** Pipeline stage ID. */
  stageId?: string
  pipelineId?: string
  /** Assigned user ID. */
  assignedUserId?: string
  /** Lead status (NEW, CONTACTED, QUALIFIED, UNQUALIFIED, NURTURING). */
  leadStatus?: string
  /** Lead tier (TIER_1, TIER_2, TIER_3). */
  tier?: string
}

export type LeadFilterKey = keyof LeadFilters

export interface FiltersState {
  leads: LeadFilters
  /** Explicit view replacement invalidates a reviewed selection even for equal filters. */
  leadViewRevision: number
  /**
   * Set a single lead filter value. Passing `''`, `null`, or `undefined`
   * clears the filter. This is the typical handler bound to `<select>`
   * and `<input>` elements.
   */
  setLeadFilter: <K extends LeadFilterKey>(
    key: K,
    value: LeadFilters[K] | '' | null | undefined,
  ) => void
  /** Replace the entire leads filter slice. */
  setLeadFilters: (filters: LeadFilters) => void
  /** Reset all lead filters back to unset. */
  resetLeadFilters: () => void
}

const emptyLeadFilters: LeadFilters = {}

function normalize(
  value: string | null | undefined,
): string | undefined {
  if (value === null || value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

export const useFiltersStore = create<FiltersState>((set) => ({
  leads: { ...emptyLeadFilters },
  leadViewRevision: 0,
  setLeadFilter: (key, value) =>
    set((state) => {
      const next = { ...state.leads }
      const normalized = normalize(value as string | null | undefined)
      if (normalized === undefined) {
        delete next[key]
      } else {
        next[key] = normalized as LeadFilters[typeof key]
      }
      return { leads: next }
    }),
  setLeadFilters: (filters) =>
    set((state) => {
      // Normalize all values so '' is never retained.
      const normalized: LeadFilters = {}
      for (const [k, v] of Object.entries(filters)) {
        const n = normalize(v as string | null | undefined)
        if (n !== undefined) {
          normalized[k as LeadFilterKey] = n
        }
      }
      return { leads: normalized, leadViewRevision: state.leadViewRevision + 1 }
    }),
  resetLeadFilters: () => set({ leads: { ...emptyLeadFilters } }),
}))
