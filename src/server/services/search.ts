import { prisma } from '@/server/db/client'
import { AppError } from '@/lib/errors'

/**
 * Entity types that can appear in search results.
 */
export type SearchEntityType = 'Lead' | 'Contact' | 'Company'

/**
 * A single search result item with entity type, ID, name, and relevance score.
 */
export interface SearchResult {
  entityType: SearchEntityType
  id: string
  name: string
  matchScore: number
}

/**
 * Optional filters for narrowing search results.
 */
export interface SearchFilters {
  /** Filter to a specific entity type */
  entityType?: SearchEntityType
  /** Filter by creation date range */
  dateRange?: {
    from?: Date
    to?: Date
  }
  /** Filter leads by assigned user (only applies to Lead entity type) */
  assignedUserId?: string
}

/**
 * Converts user input into a PostgreSQL tsquery-compatible string.
 *
 * Splits the input on whitespace, removes non-alphanumeric characters
 * (except hyphens within words), and joins with '&' for AND semantics.
 *
 * Examples:
 *   "John Smith" → "John & Smith"
 *   "acme corp" → "acme & corp"
 *   "" → null (indicates no valid query)
 */
export function buildTsQueryString(input: string): string | null {
  const words = input
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[^\w-]/g, ''))
    .filter((word) => word.length > 0)

  if (words.length === 0) return null

  // Append :* to each word for prefix matching
  return words.map((w) => `${w}:*`).join(' & ')
}

/**
 * Builds an ILIKE pattern for fallback search when tsvector is not populated.
 */
function buildIlikePattern(query: string): string {
  const sanitized = query.trim().replace(/[%_\\]/g, '\\$&')
  return `%${sanitized}%`
}

/**
 * Performs full-text search across leads, contacts, and companies within an organization.
 *
 * Uses PostgreSQL tsvector with ts_rank for ranking when search vectors are populated.
 * Falls back to ILIKE search on name fields when tsvector fields are not available.
 *
 * - Excludes soft-deleted leads (WHERE "deletedAt" IS NULL)
 * - Scopes all queries by organizationId
 * - Supports optional filters: entityType, dateRange (createdAt), assignedUserId (leads only)
 *
 * Validates: Requirements 12.1, 12.2, 12.3, 12.4
 */
export async function search(
  query: string,
  orgId: string,
  filters?: SearchFilters,
): Promise<SearchResult[]> {
  if (!orgId) {
    throw new AppError('INVALID_ORG', 'Organization ID is required', 400)
  }

  const trimmedQuery = query.trim()
  if (!trimmedQuery) {
    return []
  }

  const tsQueryString = buildTsQueryString(trimmedQuery)
  const ilikePattern = buildIlikePattern(trimmedQuery)

  const results: SearchResult[] = []

  // Determine which entity types to search
  const searchLeads = !filters?.entityType || filters.entityType === 'Lead'
  const searchContacts = !filters?.entityType || filters.entityType === 'Contact'
  const searchCompanies = !filters?.entityType || filters.entityType === 'Company'

  // Build date range conditions
  const dateFromCondition = filters?.dateRange?.from
    ? `AND "createdAt" >= $dateFrom`
    : ''
  const dateToCondition = filters?.dateRange?.to
    ? `AND "createdAt" <= $dateTo`
    : ''

  // Execute searches in parallel
  const searchPromises: Promise<void>[] = []

  if (searchLeads) {
    searchPromises.push(searchLeadsEntity(orgId, tsQueryString, ilikePattern, filters, results))
  }

  if (searchContacts) {
    searchPromises.push(searchContactsEntity(orgId, tsQueryString, ilikePattern, filters, results))
  }

  if (searchCompanies) {
    searchPromises.push(searchCompaniesEntity(orgId, tsQueryString, ilikePattern, filters, results))
  }

  await Promise.all(searchPromises)

  // Sort by matchScore descending
  results.sort((a, b) => b.matchScore - a.matchScore)

  return results
}

/**
 * Searches leads using tsvector with ILIKE fallback.
 * Excludes soft-deleted leads (deletedAt IS NULL).
 * Supports assignedUserId filter.
 */
async function searchLeadsEntity(
  orgId: string,
  tsQueryString: string | null,
  ilikePattern: string,
  filters: SearchFilters | undefined,
  results: SearchResult[],
): Promise<void> {
  // Build dynamic WHERE conditions
  const conditions: string[] = [
    `"organizationId" = $1`,
    `"deletedAt" IS NULL`,
  ]
  const params: unknown[] = [orgId]

  // Assigned user filter (leads only)
  if (filters?.assignedUserId) {
    params.push(filters.assignedUserId)
    conditions.push(`"assignedUserId" = $${params.length}`)
  }

  // Date range filters
  if (filters?.dateRange?.from) {
    params.push(filters.dateRange.from)
    conditions.push(`"createdAt" >= $${params.length}`)
  }
  if (filters?.dateRange?.to) {
    params.push(filters.dateRange.to)
    conditions.push(`"createdAt" <= $${params.length}`)
  }

  const whereClause = conditions.join(' AND ')

  // Try tsvector search first, then fallback to ILIKE
  if (tsQueryString) {
    params.push(tsQueryString)
    const tsQueryParam = `$${params.length}`

    const rows = await prisma.$queryRawUnsafe<
      Array<{ id: string; name: string; rank: number }>
    >(
      `SELECT id, "firstName" || ' ' || "lastName" AS name,
              COALESCE(ts_rank("searchVector", to_tsquery('english', ${tsQueryParam})), 0) AS rank
       FROM "Lead"
       WHERE ${whereClause}
         AND (
           "searchVector" IS NOT NULL AND "searchVector" @@ to_tsquery('english', ${tsQueryParam})
           OR "searchVector" IS NULL AND (
             "firstName" || ' ' || "lastName" ILIKE ${`$${params.length + 1}`}
             OR COALESCE("email", '') ILIKE ${`$${params.length + 1}`}
             OR COALESCE("companyName", '') ILIKE ${`$${params.length + 1}`}
           )
         )
       ORDER BY rank DESC
       LIMIT 50`,
      ...params,
      ilikePattern,
    )

    for (const row of rows) {
      results.push({
        entityType: 'Lead',
        id: row.id,
        name: row.name,
        matchScore: row.rank > 0 ? row.rank : 0.1,
      })
    }
  } else {
    // Pure ILIKE fallback when tsquery can't be built
    params.push(ilikePattern)
    const ilikeParam = `$${params.length}`

    const rows = await prisma.$queryRawUnsafe<
      Array<{ id: string; name: string }>
    >(
      `SELECT id, "firstName" || ' ' || "lastName" AS name
       FROM "Lead"
       WHERE ${whereClause}
         AND (
           "firstName" || ' ' || "lastName" ILIKE ${ilikeParam}
           OR COALESCE("email", '') ILIKE ${ilikeParam}
           OR COALESCE("companyName", '') ILIKE ${ilikeParam}
         )
       ORDER BY "createdAt" DESC
       LIMIT 50`,
      ...params,
    )

    for (const row of rows) {
      results.push({
        entityType: 'Lead',
        id: row.id,
        name: row.name,
        matchScore: 0.1,
      })
    }
  }
}

/**
 * Searches contacts using tsvector with ILIKE fallback.
 */
async function searchContactsEntity(
  orgId: string,
  tsQueryString: string | null,
  ilikePattern: string,
  filters: SearchFilters | undefined,
  results: SearchResult[],
): Promise<void> {
  const conditions: string[] = [`"organizationId" = $1`]
  const params: unknown[] = [orgId]

  // Date range filters
  if (filters?.dateRange?.from) {
    params.push(filters.dateRange.from)
    conditions.push(`"createdAt" >= $${params.length}`)
  }
  if (filters?.dateRange?.to) {
    params.push(filters.dateRange.to)
    conditions.push(`"createdAt" <= $${params.length}`)
  }

  const whereClause = conditions.join(' AND ')

  if (tsQueryString) {
    params.push(tsQueryString)
    const tsQueryParam = `$${params.length}`

    const rows = await prisma.$queryRawUnsafe<
      Array<{ id: string; name: string; rank: number }>
    >(
      `SELECT id, "firstName" || ' ' || "lastName" AS name,
              COALESCE(ts_rank("searchVector", to_tsquery('english', ${tsQueryParam})), 0) AS rank
       FROM "Contact"
       WHERE ${whereClause}
         AND (
           "searchVector" IS NOT NULL AND "searchVector" @@ to_tsquery('english', ${tsQueryParam})
           OR "searchVector" IS NULL AND (
             "firstName" || ' ' || "lastName" ILIKE ${`$${params.length + 1}`}
             OR COALESCE("email", '') ILIKE ${`$${params.length + 1}`}
           )
         )
       ORDER BY rank DESC
       LIMIT 50`,
      ...params,
      ilikePattern,
    )

    for (const row of rows) {
      results.push({
        entityType: 'Contact',
        id: row.id,
        name: row.name,
        matchScore: row.rank > 0 ? row.rank : 0.1,
      })
    }
  } else {
    params.push(ilikePattern)
    const ilikeParam = `$${params.length}`

    const rows = await prisma.$queryRawUnsafe<
      Array<{ id: string; name: string }>
    >(
      `SELECT id, "firstName" || ' ' || "lastName" AS name
       FROM "Contact"
       WHERE ${whereClause}
         AND (
           "firstName" || ' ' || "lastName" ILIKE ${ilikeParam}
           OR COALESCE("email", '') ILIKE ${ilikeParam}
         )
       ORDER BY "createdAt" DESC
       LIMIT 50`,
      ...params,
    )

    for (const row of rows) {
      results.push({
        entityType: 'Contact',
        id: row.id,
        name: row.name,
        matchScore: 0.1,
      })
    }
  }
}

/**
 * Searches companies using tsvector with ILIKE fallback.
 */
async function searchCompaniesEntity(
  orgId: string,
  tsQueryString: string | null,
  ilikePattern: string,
  filters: SearchFilters | undefined,
  results: SearchResult[],
): Promise<void> {
  const conditions: string[] = [`"organizationId" = $1`]
  const params: unknown[] = [orgId]

  // Date range filters
  if (filters?.dateRange?.from) {
    params.push(filters.dateRange.from)
    conditions.push(`"createdAt" >= $${params.length}`)
  }
  if (filters?.dateRange?.to) {
    params.push(filters.dateRange.to)
    conditions.push(`"createdAt" <= $${params.length}`)
  }

  const whereClause = conditions.join(' AND ')

  if (tsQueryString) {
    params.push(tsQueryString)
    const tsQueryParam = `$${params.length}`

    const rows = await prisma.$queryRawUnsafe<
      Array<{ id: string; name: string; rank: number }>
    >(
      `SELECT id, "name",
              COALESCE(ts_rank("searchVector", to_tsquery('english', ${tsQueryParam})), 0) AS rank
       FROM "Company"
       WHERE ${whereClause}
         AND (
           "searchVector" IS NOT NULL AND "searchVector" @@ to_tsquery('english', ${tsQueryParam})
           OR "searchVector" IS NULL AND (
             "name" ILIKE ${`$${params.length + 1}`}
             OR COALESCE("industry", '') ILIKE ${`$${params.length + 1}`}
           )
         )
       ORDER BY rank DESC
       LIMIT 50`,
      ...params,
      ilikePattern,
    )

    for (const row of rows) {
      results.push({
        entityType: 'Company',
        id: row.id,
        name: row.name,
        matchScore: row.rank > 0 ? row.rank : 0.1,
      })
    }
  } else {
    params.push(ilikePattern)
    const ilikeParam = `$${params.length}`

    const rows = await prisma.$queryRawUnsafe<
      Array<{ id: string; name: string }>
    >(
      `SELECT id, "name"
       FROM "Company"
       WHERE ${whereClause}
         AND (
           "name" ILIKE ${ilikeParam}
           OR COALESCE("industry", '') ILIKE ${ilikeParam}
         )
       ORDER BY "createdAt" DESC
       LIMIT 50`,
      ...params,
    )

    for (const row of rows) {
      results.push({
        entityType: 'Company',
        id: row.id,
        name: row.name,
        matchScore: 0.1,
      })
    }
  }
}
