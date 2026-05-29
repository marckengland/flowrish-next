'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

/**
 * TanStack Query hooks for cadence data.
 *
 * Server state (cadences, enrollments, analytics) lives here; any client
 * UI state around the cadence builder/enroll dialog lives in local component
 * state — there is no Zustand slice for cadences yet.
 *
 * Validates: Requirements 6.1, 6.2, 6.5, 6.10, 32.1, 32.2, 32.3, 32.4, 32.5
 */

// ─── Shared types ───────────────────────────────────────────────────────────

export type CadenceStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED'
export type EnrollmentStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'EXITED'
export type StepActionType = 'EMAIL' | 'CALL' | 'LINKEDIN' | 'MANUAL_TASK'
export type ExitReason =
  | 'reply_received'
  | 'meeting_booked'
  | 'cadence_archived'
  | 'lead_converted'
  | 'manual'

export interface CadenceStep {
  id: string
  cadenceId: string
  stepOrder: number
  actionType: StepActionType
  delayHours: number
  emailSubject: string | null
  emailBody: string | null
  taskTitle: string | null
  taskDescription: string | null
  createdAt: string
  updatedAt: string
}

export interface CadenceListItem {
  id: string
  name: string
  status: CadenceStatus
  createdById: string
  createdAt: string
  updatedAt: string
  steps: CadenceStep[]
  _count: { enrollments: number }
}

export type CadenceDetail = CadenceListItem

export interface CadencesPage {
  data: CadenceListItem[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

export interface CadenceAnalytics {
  cadenceId: string
  cadenceName: string
  cadenceStatus: CadenceStatus
  totalEnrollments: number
  activeEnrollments: number
  completedEnrollments: number
  exitedEnrollments: number
  pausedEnrollments: number
  completionRate: number
}

export interface EnrollmentListItem {
  id: string
  cadenceId: string
  leadId: string
  enrolledById: string
  status: EnrollmentStatus
  currentStepOrder: number
  exitReason: string | null
  enrolledAt: string
  completedAt: string | null
  updatedAt: string
  lead?: {
    id: string
    firstName: string
    lastName: string
    email: string | null
    companyName: string | null
  } | null
}

// ─── Query keys ─────────────────────────────────────────────────────────────

export const cadenceKeys = {
  all: ['cadences'] as const,
  list: (input: { status?: CadenceStatus | 'ALL'; page?: number; pageSize?: number }) =>
    [...cadenceKeys.all, 'list', input] as const,
  detail: (id: string) => [...cadenceKeys.all, 'detail', id] as const,
  analytics: (id: string) => [...cadenceKeys.all, 'analytics', id] as const,
}

// ─── Fetchers ───────────────────────────────────────────────────────────────

async function readErrorMessage(
  res: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } }
    if (body.error?.message) return body.error.message
  } catch {
    // ignore parse failures
  }
  return `${fallback} (${res.status})`
}

async function fetchCadences(input: {
  status?: CadenceStatus | 'ALL'
  page?: number
  pageSize?: number
}): Promise<CadencesPage> {
  const params = new URLSearchParams()
  if (input.page !== undefined) params.set('page', String(input.page))
  if (input.pageSize !== undefined) params.set('pageSize', String(input.pageSize))
  if (input.status && input.status !== 'ALL') {
    params.set('status', input.status)
  }
  const qs = params.toString()
  const res = await fetch(`/api/cadences${qs ? `?${qs}` : ''}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  })
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, 'Failed to load cadences'))
  }
  return (await res.json()) as CadencesPage
}

async function fetchCadence(id: string): Promise<CadenceDetail> {
  const res = await fetch(`/api/cadences/${id}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  })
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, 'Failed to load cadence'))
  }
  const body = (await res.json()) as { data: CadenceDetail }
  return body.data
}

async function fetchAnalytics(id: string): Promise<CadenceAnalytics> {
  const res = await fetch(`/api/cadences/${id}/analytics`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  })
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, 'Failed to load analytics'))
  }
  const body = (await res.json()) as { data: CadenceAnalytics }
  return body.data
}

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Fetches a paginated page of cadences. Pass `initialData` from the
 * Server Component render so the list paints immediately.
 */
export function useCadencesQuery(
  input: { status?: CadenceStatus | 'ALL'; page?: number; pageSize?: number } = {},
  initialData?: CadencesPage,
) {
  return useQuery({
    queryKey: cadenceKeys.list(input),
    queryFn: () => fetchCadences(input),
    initialData,
  })
}

/**
 * Fetches a single cadence by ID with its steps. Pass `initialData` from the
 * Server Component render so the detail view paints immediately.
 */
export function useCadenceQuery(id: string, initialData?: CadenceDetail) {
  return useQuery({
    queryKey: cadenceKeys.detail(id),
    queryFn: () => fetchCadence(id),
    enabled: Boolean(id),
    initialData,
  })
}

/**
 * Fetches analytics for a cadence — enrollment counts and completion rate.
 */
export function useCadenceAnalyticsQuery(
  id: string,
  initialData?: CadenceAnalytics,
) {
  return useQuery({
    queryKey: cadenceKeys.analytics(id),
    queryFn: () => fetchAnalytics(id),
    enabled: Boolean(id),
    initialData,
  })
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Activates a cadence (DRAFT → ACTIVE). Invalidates list + detail caches.
 */
export function useActivateCadenceMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string): Promise<CadenceDetail> => {
      const res = await fetch(`/api/cadences/${id}/activate`, {
        method: 'PATCH',
        credentials: 'same-origin',
      })
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'Failed to activate cadence'))
      }
      const body = (await res.json()) as { data: CadenceDetail }
      return body.data
    },
    onSuccess: (cadence) => {
      queryClient.invalidateQueries({ queryKey: cadenceKeys.all })
      queryClient.setQueryData(cadenceKeys.detail(cadence.id), cadence)
    },
  })
}

/**
 * Deletes a cadence. The server rejects deletion when active enrollments
 * exist — the returned error message surfaces that constraint to the UI.
 */
export function useDeleteCadenceMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string): Promise<string> => {
      const res = await fetch(`/api/cadences/${id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'Failed to delete cadence'))
      }
      return id
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: cadenceKeys.all })
    },
  })
}

export interface EnrollLeadInput {
  cadenceId: string
  leadId: string
}

/**
 * Enrolls a single lead in a cadence.
 */
export function useEnrollLeadMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ cadenceId, leadId }: EnrollLeadInput) => {
      const res = await fetch(`/api/cadences/${cadenceId}/enroll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({ leadId }),
      })
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'Failed to enroll lead'))
      }
      const body = (await res.json()) as { data: EnrollmentListItem }
      return body.data
    },
    onSuccess: (_enrollment, variables) => {
      queryClient.invalidateQueries({ queryKey: cadenceKeys.all })
      queryClient.invalidateQueries({
        queryKey: cadenceKeys.analytics(variables.cadenceId),
      })
    },
  })
}

export interface BulkEnrollLeadsInput {
  cadenceId: string
  leadIds: string[]
}

export interface BulkEnrollResult {
  enrolled: EnrollmentListItem[]
  skipped: string[]
  enrolledCount: number
  skippedCount: number
}

/**
 * Bulk enrolls multiple leads. Leads with an existing ACTIVE enrollment
 * are skipped (no error), matching the service contract.
 */
export function useBulkEnrollMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      cadenceId,
      leadIds,
    }: BulkEnrollLeadsInput): Promise<BulkEnrollResult> => {
      const res = await fetch(`/api/cadences/${cadenceId}/bulk-enroll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({ leadIds }),
      })
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'Failed to enroll leads'))
      }
      const body = (await res.json()) as { data: BulkEnrollResult }
      return body.data
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: cadenceKeys.all })
      queryClient.invalidateQueries({
        queryKey: cadenceKeys.analytics(variables.cadenceId),
      })
    },
  })
}

/**
 * Pauses an active enrollment.
 */
export function usePauseEnrollmentMutation(cadenceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (enrollmentId: string): Promise<EnrollmentListItem> => {
      const res = await fetch(`/api/cadences/enrollments/${enrollmentId}/pause`, {
        method: 'PATCH',
        credentials: 'same-origin',
      })
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'Failed to pause enrollment'))
      }
      const body = (await res.json()) as { data: EnrollmentListItem }
      return body.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: cadenceKeys.analytics(cadenceId) })
      queryClient.invalidateQueries({ queryKey: cadenceKeys.detail(cadenceId) })
    },
  })
}

/**
 * Resumes a paused enrollment.
 */
export function useResumeEnrollmentMutation(cadenceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (enrollmentId: string): Promise<EnrollmentListItem> => {
      const res = await fetch(`/api/cadences/enrollments/${enrollmentId}/resume`, {
        method: 'PATCH',
        credentials: 'same-origin',
      })
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'Failed to resume enrollment'))
      }
      const body = (await res.json()) as { data: EnrollmentListItem }
      return body.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: cadenceKeys.analytics(cadenceId) })
      queryClient.invalidateQueries({ queryKey: cadenceKeys.detail(cadenceId) })
    },
  })
}

/**
 * Exits an enrollment with a reason. Used by the "Exit" action on the
 * enrollment list.
 */
export function useExitEnrollmentMutation(cadenceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      enrollmentId: string
      reason: ExitReason
    }): Promise<EnrollmentListItem> => {
      const res = await fetch(
        `/api/cadences/enrollments/${input.enrollmentId}/exit`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          credentials: 'same-origin',
          body: JSON.stringify({ reason: input.reason }),
        },
      )
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'Failed to exit enrollment'))
      }
      const body = (await res.json()) as { data: EnrollmentListItem }
      return body.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: cadenceKeys.analytics(cadenceId) })
      queryClient.invalidateQueries({ queryKey: cadenceKeys.detail(cadenceId) })
    },
  })
}
