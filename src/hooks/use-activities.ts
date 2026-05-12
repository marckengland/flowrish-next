'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

/**
 * TanStack Query hooks for activity data.
 *
 * Activities are always scoped to a lead. The server enforces RBAC +
 * tenant isolation; this module only handles the client-side fetch
 * plumbing and cache invalidation so components stay stateless.
 *
 * Validates: Requirements 5.1, 5.2, 5.4, 26.3
 */

/**
 * Activity shape returned by `GET /api/activities/[leadId]`. The API
 * JSON-encodes `Date` fields as ISO strings; `attendees` is a JSON array
 * string that the timeline parses lazily when rendering.
 */
export interface ActivityItem {
  id: string
  type: 'CALL' | 'MEETING' | 'NOTE' | 'EMAIL' | 'FILE_ATTACHMENT'
  leadId: string
  createdById: string
  notes: string | null
  callDate: string | null
  callDuration: number | null
  meetingDate: string | null
  attendees: string | null
  emailMessageId: string | null
  createdAt: string
}

export const activitiesKeys = {
  all: ['activities'] as const,
  byLead: (leadId: string) => [...activitiesKeys.all, 'byLead', leadId] as const,
}

async function fetchActivitiesByLead(leadId: string): Promise<ActivityItem[]> {
  const res = await fetch(`/api/activities/${leadId}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  })
  if (!res.ok) {
    let message = `Failed to load activities (${res.status})`
    try {
      const body = (await res.json()) as { error?: { message?: string } }
      if (body.error?.message) message = body.error.message
    } catch {
      // ignore
    }
    throw new Error(message)
  }
  const body = (await res.json()) as { data: ActivityItem[] }
  return body.data
}

/**
 * Fetches all activities for a lead, sorted by createdAt descending.
 *
 * Pass `initialData` from the Server Component render so the timeline
 * paints immediately and only refetches when the query key invalidates
 * (for example, after `useCreateActivityMutation` succeeds).
 */
export function useLeadActivitiesQuery(
  leadId: string,
  initialData?: ActivityItem[],
) {
  return useQuery({
    queryKey: activitiesKeys.byLead(leadId),
    queryFn: () => fetchActivitiesByLead(leadId),
    enabled: Boolean(leadId),
    initialData,
  })
}

export interface CreateActivityPayload {
  leadId: string
  type: ActivityItem['type']
  notes?: string | null
  callDate?: string | null
  callDuration?: number | null
  meetingDate?: string | null
  attendees?: string[] | null
}

/**
 * Logs a new activity against a lead via `POST /api/activities` and
 * invalidates the activity cache for that lead so the timeline refetches.
 */
export function useCreateActivityMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CreateActivityPayload): Promise<ActivityItem> => {
      const res = await fetch('/api/activities', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        let message = `Failed to log activity (${res.status})`
        try {
          const body = (await res.json()) as { error?: { message?: string } }
          if (body.error?.message) message = body.error.message
        } catch {
          // ignore
        }
        throw new Error(message)
      }
      const body = (await res.json()) as { data: ActivityItem }
      return body.data
    },
    onSuccess: (activity) => {
      queryClient.invalidateQueries({ queryKey: activitiesKeys.byLead(activity.leadId) })
    },
  })
}

/**
 * Parses the stored `attendees` column (JSON string) into a plain array,
 * returning `[]` on null/parse failure so UI code never has to guard.
 */
export function parseAttendees(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === 'string')
    }
    return []
  } catch {
    return []
  }
}
