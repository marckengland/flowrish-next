import { z } from 'zod'
import { sanitizedString } from './common'

/**
 * Entity types that can be filtered in search results.
 * Matches the `SearchEntityType` used by the search service.
 */
export const searchEntityTypeEnum = z.enum(['Lead', 'Contact', 'Company'])

export type SearchEntityTypeInput = z.infer<typeof searchEntityTypeEnum>

/**
 * Schema for search query parameters.
 *
 * Supported query params:
 * - `q` (required): The search query string
 * - `entityType?`: Restrict results to a single entity type (Lead | Contact | Company)
 * - `dateFrom?`: Inclusive lower bound for createdAt (ISO 8601 date-time string)
 * - `dateTo?`: Inclusive upper bound for createdAt (ISO 8601 date-time string)
 * - `assignedUserId?`: Restrict lead results to those assigned to this user (UUID)
 * - `stageName?`: Lead-only filter — case-insensitive substring match on the stage name
 * - `scoreMin?`: Lead-only filter — minimum lead score (0–100, inclusive)
 * - `scoreMax?`: Lead-only filter — maximum lead score (0–100, inclusive)
 *
 * Lead-only filters are silently ignored for Contact / Company results
 * (they don't have those columns) so the same filter shape can drive
 * the entire search surface.
 *
 * Validates: Requirements 12.2, 12.4
 */
export const searchQuerySchema = z.object({
  q: sanitizedString.pipe(z.string().min(1, 'Search query is required')),
  entityType: searchEntityTypeEnum.optional(),
  dateFrom: z
    .string()
    .datetime({ message: 'dateFrom must be a valid ISO 8601 date-time string' })
    .optional(),
  dateTo: z
    .string()
    .datetime({ message: 'dateTo must be a valid ISO 8601 date-time string' })
    .optional(),
  assignedUserId: z.string().uuid('Invalid assignedUserId').optional(),
  stageName: sanitizedString.pipe(z.string().min(1).max(100)).optional(),
  scoreMin: z.coerce.number().int().min(0).max(100).optional(),
  scoreMax: z.coerce.number().int().min(0).max(100).optional(),
})

export type SearchQueryInput = z.infer<typeof searchQuerySchema>
