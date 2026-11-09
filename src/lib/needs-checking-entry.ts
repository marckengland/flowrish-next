import { z } from 'zod'
import type { SavedFollowUpSettings } from './saved-follow-up-views'

export function needsCheckingEntry(query: { needsChecking?: unknown; status?: unknown; match?: unknown; reply?: unknown }): SavedFollowUpSettings['status'] | undefined {
  if (query.needsChecking !== '1' || query.match || query.reply) return undefined
  const tab = z.enum(['PENDING', 'APPROVED', 'DISMISSED', 'SNOOZED']).safeParse(query.status ?? 'PENDING')
  return tab.success ? tab.data : undefined
}
