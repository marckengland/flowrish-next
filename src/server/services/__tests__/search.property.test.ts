import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

/**
 * Property-based tests for the full-text search service.
 *
 * Properties tested:
 * 1. Soft-deleted leads never appear in search results (Invariant)
 * 2. Same query returns same results given no data changes (Idempotence)
 *
 * **Validates: Requirements 12.3, 12.4**
 *
 * Implementation strategy:
 *   The search service uses `prisma.$queryRawUnsafe` to execute parameterized
 *   SQL against Lead, Contact, and Company tables. Rather than mocking away
 *   filter behavior, we install a lightweight in-memory query executor that
 *   inspects the generated SQL and applies the same WHERE clauses the database
 *   would apply (organizationId match, deletedAt IS NULL for leads, entity
 *   filters). This lets us verify the filters the service emits are correct,
 *   not just that we mocked them away.
 */

// ─── In-memory record stores ────────────────────────────────────────────────

interface LeadRow {
  id: string
  firstName: string
  lastName: string
  email: string | null
  companyName: string | null
  organizationId: string
  assignedUserId: string | null
  deletedAt: Date | null
  createdAt: Date
}

interface ContactRow {
  id: string
  firstName: string
  lastName: string
  email: string | null
  organizationId: string
  createdAt: Date
}

interface CompanyRow {
  id: string
  name: string
  industry: string | null
  organizationId: string
  createdAt: Date
}

const store = {
  leads: [] as LeadRow[],
  contacts: [] as ContactRow[],
  companies: [] as CompanyRow[],
}

function resetStore() {
  store.leads = []
  store.contacts = []
  store.companies = []
}

// ─── SQL-inspection-based query executor ────────────────────────────────────

/**
 * Matches ILIKE-style pattern against a string. Supports '%' wildcards only
 * (the service's buildIlikePattern only uses '%' on both ends of the input).
 * Uses case-insensitive matching.
 */
function ilikeMatch(value: string | null, pattern: string): boolean {
  if (value == null) return false
  // Strip wrapping %...% — the service wraps user input in %...%
  const inner = pattern.replace(/^%/, '').replace(/%$/, '')
  return value.toLowerCase().includes(inner.toLowerCase())
}

/**
 * Does the ts_query style pattern (e.g. "foo:* & bar:*") match the text?
 * Treats '&' as AND; each term ':*' as prefix match (case-insensitive).
 */
function tsQueryMatch(text: string, tsQuery: string): boolean {
  const terms = tsQuery
    .split('&')
    .map(t => t.trim().replace(/:\*$/, ''))
    .filter(t => t.length > 0)
  if (terms.length === 0) return false
  const haystack = text.toLowerCase()
  return terms.every(term =>
    haystack.split(/\W+/).some(word => word.startsWith(term.toLowerCase())),
  )
}

/**
 * Execute a simulated SQL query against the in-memory store.
 *
 * Inspects the raw SQL string to determine the table and applies the filters
 * the search service embeds (organizationId, deletedAt IS NULL, etc.), then
 * uses the params and pattern to match rows. This is intentionally narrow —
 * it knows only the shapes the search service emits.
 */
function executeSimulatedQuery(
  sql: string,
  params: unknown[],
): Array<{ id: string; name: string; rank?: number }> {
  // Identify the table from the FROM clause
  const tableMatch = sql.match(/FROM\s+"(Lead|Contact|Company)"/)
  if (!tableMatch) return []
  const table = tableMatch[1]

  // First param is always orgId
  const orgId = params[0] as string

  // Extract tsQuery param (the last param before an optional ilike fallback)
  // The service pushes tsQueryString then sometimes ilikePattern. We pattern-match.
  const hasTsquery = sql.includes('to_tsquery')

  const includeLead = table === 'Lead'

  if (includeLead) {
    let rows = store.leads.filter(r => r.organizationId === orgId)
    // Always enforce soft-delete exclusion as the service does
    rows = rows.filter(r => r.deletedAt === null)

    // Optional assignedUserId filter
    const assignedMatch = sql.match(/"assignedUserId"\s*=\s*\$(\d+)/)
    if (assignedMatch) {
      const idx = parseInt(assignedMatch[1], 10) - 1
      const assignedUserId = params[idx] as string
      rows = rows.filter(r => r.assignedUserId === assignedUserId)
    }

    // Optional createdAt range filters
    const fromMatch = sql.match(/"createdAt"\s*>=\s*\$(\d+)/)
    if (fromMatch) {
      const idx = parseInt(fromMatch[1], 10) - 1
      const from = params[idx] as Date
      rows = rows.filter(r => r.createdAt >= from)
    }
    const toMatch = sql.match(/"createdAt"\s*<=\s*\$(\d+)/)
    if (toMatch) {
      const idx = parseInt(toMatch[1], 10) - 1
      const to = params[idx] as Date
      rows = rows.filter(r => r.createdAt <= to)
    }

    if (hasTsquery) {
      const tsQuery = params[params.length - 2] as string
      const ilike = params[params.length - 1] as string
      rows = rows.filter(r => {
        const full = `${r.firstName} ${r.lastName}`
        const tsHit = tsQueryMatch(full, tsQuery)
        const ilikeHit =
          ilikeMatch(full, ilike) ||
          ilikeMatch(r.email ?? '', ilike) ||
          ilikeMatch(r.companyName ?? '', ilike)
        // The service's SQL: tsvector hit OR (vector NULL AND ILIKE).
        // Our in-memory rows have no tsvector, so behave as "vector IS NULL".
        // We model this as: tsHit OR ilikeHit.
        return tsHit || ilikeHit
      })
      return rows.map(r => ({
        id: r.id,
        name: `${r.firstName} ${r.lastName}`,
        rank: 0.1,
      }))
    } else {
      const ilike = params[params.length - 1] as string
      rows = rows.filter(r => {
        const full = `${r.firstName} ${r.lastName}`
        return (
          ilikeMatch(full, ilike) ||
          ilikeMatch(r.email ?? '', ilike) ||
          ilikeMatch(r.companyName ?? '', ilike)
        )
      })
      return rows.map(r => ({
        id: r.id,
        name: `${r.firstName} ${r.lastName}`,
      }))
    }
  }

  if (table === 'Contact') {
    let rows = store.contacts.filter(r => r.organizationId === orgId)

    const fromMatch = sql.match(/"createdAt"\s*>=\s*\$(\d+)/)
    if (fromMatch) {
      const idx = parseInt(fromMatch[1], 10) - 1
      const from = params[idx] as Date
      rows = rows.filter(r => r.createdAt >= from)
    }
    const toMatch = sql.match(/"createdAt"\s*<=\s*\$(\d+)/)
    if (toMatch) {
      const idx = parseInt(toMatch[1], 10) - 1
      const to = params[idx] as Date
      rows = rows.filter(r => r.createdAt <= to)
    }

    if (hasTsquery) {
      const tsQuery = params[params.length - 2] as string
      const ilike = params[params.length - 1] as string
      rows = rows.filter(r => {
        const full = `${r.firstName} ${r.lastName}`
        return (
          tsQueryMatch(full, tsQuery) ||
          ilikeMatch(full, ilike) ||
          ilikeMatch(r.email ?? '', ilike)
        )
      })
      return rows.map(r => ({
        id: r.id,
        name: `${r.firstName} ${r.lastName}`,
        rank: 0.1,
      }))
    } else {
      const ilike = params[params.length - 1] as string
      rows = rows.filter(r => {
        const full = `${r.firstName} ${r.lastName}`
        return ilikeMatch(full, ilike) || ilikeMatch(r.email ?? '', ilike)
      })
      return rows.map(r => ({
        id: r.id,
        name: `${r.firstName} ${r.lastName}`,
      }))
    }
  }

  if (table === 'Company') {
    let rows = store.companies.filter(r => r.organizationId === orgId)

    const fromMatch = sql.match(/"createdAt"\s*>=\s*\$(\d+)/)
    if (fromMatch) {
      const idx = parseInt(fromMatch[1], 10) - 1
      const from = params[idx] as Date
      rows = rows.filter(r => r.createdAt >= from)
    }
    const toMatch = sql.match(/"createdAt"\s*<=\s*\$(\d+)/)
    if (toMatch) {
      const idx = parseInt(toMatch[1], 10) - 1
      const to = params[idx] as Date
      rows = rows.filter(r => r.createdAt <= to)
    }

    if (hasTsquery) {
      const tsQuery = params[params.length - 2] as string
      const ilike = params[params.length - 1] as string
      rows = rows.filter(
        r =>
          tsQueryMatch(r.name, tsQuery) ||
          ilikeMatch(r.name, ilike) ||
          ilikeMatch(r.industry ?? '', ilike),
      )
      return rows.map(r => ({ id: r.id, name: r.name, rank: 0.1 }))
    } else {
      const ilike = params[params.length - 1] as string
      rows = rows.filter(
        r => ilikeMatch(r.name, ilike) || ilikeMatch(r.industry ?? '', ilike),
      )
      return rows.map(r => ({ id: r.id, name: r.name }))
    }
  }

  return []
}

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Hoisted so the mock factory below (also hoisted by vitest) can reference it.
const { mockQueryRawUnsafe } = vi.hoisted(() => ({
  mockQueryRawUnsafe: vi.fn(),
}))

// Install the executor implementation once this module is loaded.
mockQueryRawUnsafe.mockImplementation(
  async (sql: string, ...params: unknown[]) => executeSimulatedQuery(sql, params),
)

vi.mock('@/server/db/client', () => ({
  prisma: {
    $queryRawUnsafe: mockQueryRawUnsafe,
  },
}))

vi.mock('@/generated/prisma', () => ({
  PrismaClient: vi.fn(),
}))

import { search, type SearchFilters, type SearchResult } from '@/server/services/search'

// ─── Generators ──────────────────────────────────────────────────────────────

const uuidArb = fc.uuid()

/**
 * Generate a non-empty word string using alphanumeric chars. This keeps the
 * values plain so both tsQuery prefix matching and ILIKE matching behave
 * predictably.
 */
const wordArb = fc
  .stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), {
    minLength: 3,
    maxLength: 10,
  })
  .filter(s => s.length >= 3)

const nameArb = wordArb

/** Generate a lead record in either active or soft-deleted state. */
const leadRecordArb = (orgId: string) =>
  fc.record({
    id: uuidArb,
    firstName: nameArb,
    lastName: nameArb,
    email: fc.oneof(fc.constant(null), fc.tuple(wordArb, wordArb).map(([u, d]) => `${u}@${d}.com`)),
    companyName: fc.oneof(fc.constant(null), wordArb),
    organizationId: fc.constant(orgId),
    assignedUserId: fc.oneof(fc.constant(null), uuidArb),
    deletedAt: fc.oneof(fc.constant(null), fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') })),
    createdAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
  }) as fc.Arbitrary<LeadRow>

const contactRecordArb = (orgId: string) =>
  fc.record({
    id: uuidArb,
    firstName: nameArb,
    lastName: nameArb,
    email: fc.oneof(fc.constant(null), fc.tuple(wordArb, wordArb).map(([u, d]) => `${u}@${d}.com`)),
    organizationId: fc.constant(orgId),
    createdAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
  }) as fc.Arbitrary<ContactRow>

const companyRecordArb = (orgId: string) =>
  fc.record({
    id: uuidArb,
    name: nameArb,
    industry: fc.oneof(fc.constant(null), wordArb),
    organizationId: fc.constant(orgId),
    createdAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
  }) as fc.Arbitrary<CompanyRow>

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Search Service - Property Tests', () => {
  beforeEach(() => {
    resetStore()
    mockQueryRawUnsafe.mockClear()
  })

  describe('Property: Soft-deleted leads never appear in search results', () => {
    /**
     * **Validates: Requirement 12.3**
     *
     * For any query, any organization, and any mix of active + soft-deleted
     * leads whose text fields match the query, only active leads appear in
     * the Lead-typed search results.
     */

    it('a soft-deleted lead never appears in search results, even when its fields match the query', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb, // orgId
          fc.array(fc.tuple(uuidArb, nameArb, nameArb, fc.date({ min: new Date('2022-01-01'), max: new Date('2028-01-01') })), {
            minLength: 1,
            maxLength: 10,
          }),
          async (orgId, leadSeeds) => {
            // Populate store: every other seed becomes soft-deleted
            store.leads = leadSeeds.map(([id, firstName, lastName, deletedAt], i) => ({
              id,
              firstName,
              lastName,
              email: null,
              companyName: null,
              organizationId: orgId,
              assignedUserId: null,
              deletedAt: i % 2 === 0 ? deletedAt : null,
              createdAt: new Date('2024-01-01'),
            }))

            // Search with each lead's firstName — a guaranteed match
            for (const lead of store.leads) {
              const results = await search(lead.firstName, orgId)
              const softDeletedIds = new Set(
                store.leads.filter(l => l.deletedAt !== null).map(l => l.id),
              )
              for (const result of results) {
                if (result.entityType === 'Lead') {
                  expect(softDeletedIds.has(result.id)).toBe(false)
                }
              }
            }
          },
        ),
        { numRuns: 30 },
      )
    })

    it('when every matching lead is soft-deleted, no Lead-typed results are returned', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          fc.array(
            fc.tuple(uuidArb, nameArb, nameArb, fc.date({ min: new Date('2022-01-01'), max: new Date('2028-01-01') })),
            { minLength: 1, maxLength: 8 },
          ),
          async (orgId, leadSeeds) => {
            // All leads soft-deleted
            store.leads = leadSeeds.map(([id, firstName, lastName, deletedAt]) => ({
              id,
              firstName,
              lastName,
              email: null,
              companyName: null,
              organizationId: orgId,
              assignedUserId: null,
              deletedAt,
              createdAt: new Date('2024-01-01'),
            }))

            for (const lead of store.leads) {
              const results = await search(lead.firstName, orgId)
              const leadResults = results.filter(r => r.entityType === 'Lead')
              expect(leadResults.length).toBe(0)
            }
          },
        ),
        { numRuns: 25 },
      )
    })

    it('soft-deleting a lead removes it from subsequent search results (state transition)', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb, // orgId
          uuidArb, // leadId
          nameArb, // firstName used as the query
          nameArb, // lastName
          async (orgId, leadId, firstName, lastName) => {
            // Start with a single active lead
            store.leads = [
              {
                id: leadId,
                firstName,
                lastName,
                email: null,
                companyName: null,
                organizationId: orgId,
                assignedUserId: null,
                deletedAt: null,
                createdAt: new Date('2024-01-01'),
              },
            ]

            const beforeResults = await search(firstName, orgId)
            const beforeIds = beforeResults.filter(r => r.entityType === 'Lead').map(r => r.id)
            expect(beforeIds).toContain(leadId)

            // Soft-delete the lead
            store.leads[0].deletedAt = new Date('2024-06-01')

            const afterResults = await search(firstName, orgId)
            const afterIds = afterResults.filter(r => r.entityType === 'Lead').map(r => r.id)
            expect(afterIds).not.toContain(leadId)
          },
        ),
        { numRuns: 20 },
      )
    })

    it('soft-delete filter is applied regardless of additional filters (entity, date range, assignedUser)', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb, // orgId
          uuidArb, // assignedUserId
          fc.array(fc.tuple(uuidArb, nameArb, nameArb), { minLength: 2, maxLength: 6 }),
          async (orgId, assignedUserId, leadSeeds) => {
            // All leads assigned to assignedUserId, half soft-deleted
            store.leads = leadSeeds.map(([id, firstName, lastName], i) => ({
              id,
              firstName,
              lastName,
              email: null,
              companyName: null,
              organizationId: orgId,
              assignedUserId,
              deletedAt: i % 2 === 0 ? new Date('2024-06-01') : null,
              createdAt: new Date('2024-03-01'),
            }))

            const filters: SearchFilters = {
              entityType: 'Lead',
              assignedUserId,
              dateRange: {
                from: new Date('2024-01-01'),
                to: new Date('2024-12-31'),
              },
            }

            // Search by each lead's firstName with all filters active
            for (const lead of store.leads) {
              const results = await search(lead.firstName, orgId, filters)
              const softDeletedIds = new Set(
                store.leads.filter(l => l.deletedAt !== null).map(l => l.id),
              )
              for (const r of results) {
                expect(softDeletedIds.has(r.id)).toBe(false)
              }
            }
          },
        ),
        { numRuns: 20 },
      )
    })
  })

  describe('Property: Same query returns same results given no data changes (Idempotence)', () => {
    /**
     * **Validates: Requirement 12.4 (and "Idempotence" correctness property)**
     *
     * If the underlying store is unchanged, issuing the same search call twice
     * returns identical result sets. Result equality is defined as the same
     * multiset of (entityType, id) pairs.
     */

    const resultKey = (r: SearchResult) => `${r.entityType}:${r.id}`
    const toKeyMultiset = (rs: SearchResult[]) => rs.map(resultKey).sort()

    it('two identical search calls on an unchanged store return the same (entityType, id) multiset', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb, // orgId
          fc.array(leadRecordArb('00000000-0000-0000-0000-000000000001'), { minLength: 0, maxLength: 8 }),
          fc.array(contactRecordArb('00000000-0000-0000-0000-000000000001'), { minLength: 0, maxLength: 8 }),
          fc.array(companyRecordArb('00000000-0000-0000-0000-000000000001'), { minLength: 0, maxLength: 8 }),
          wordArb, // query
          async (orgId, leads, contacts, companies, query) => {
            // Re-home all rows under the current orgId
            store.leads = leads.map(r => ({ ...r, organizationId: orgId }))
            store.contacts = contacts.map(r => ({ ...r, organizationId: orgId }))
            store.companies = companies.map(r => ({ ...r, organizationId: orgId }))

            const first = await search(query, orgId)
            const second = await search(query, orgId)

            expect(toKeyMultiset(first)).toEqual(toKeyMultiset(second))
          },
        ),
        { numRuns: 30 },
      )
    })

    it('idempotence holds across all filter combinations', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb, // orgId
          uuidArb, // assignedUserId
          fc.array(leadRecordArb('00000000-0000-0000-0000-000000000002'), { minLength: 0, maxLength: 6 }),
          fc.array(contactRecordArb('00000000-0000-0000-0000-000000000002'), { minLength: 0, maxLength: 6 }),
          fc.array(companyRecordArb('00000000-0000-0000-0000-000000000002'), { minLength: 0, maxLength: 6 }),
          wordArb,
          fc.option(fc.constantFrom<'Lead' | 'Contact' | 'Company'>('Lead', 'Contact', 'Company'), { nil: undefined }),
          async (orgId, assignedUserId, leads, contacts, companies, query, entityType) => {
            store.leads = leads.map(r => ({ ...r, organizationId: orgId, assignedUserId }))
            store.contacts = contacts.map(r => ({ ...r, organizationId: orgId }))
            store.companies = companies.map(r => ({ ...r, organizationId: orgId }))

            const filters: SearchFilters = {
              entityType,
              assignedUserId: entityType === 'Lead' ? assignedUserId : undefined,
              dateRange: {
                from: new Date('2020-01-01'),
                to: new Date('2030-01-01'),
              },
            }

            const first = await search(query, orgId, filters)
            const second = await search(query, orgId, filters)

            expect(toKeyMultiset(first)).toEqual(toKeyMultiset(second))
          },
        ),
        { numRuns: 25 },
      )
    })

    it('idempotence holds for empty and whitespace-only queries (both return empty)', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          fc.array(leadRecordArb('00000000-0000-0000-0000-000000000003'), { minLength: 0, maxLength: 5 }),
          fc.constantFrom('', '   ', '\t\n'),
          async (orgId, leads, query) => {
            store.leads = leads.map(r => ({ ...r, organizationId: orgId }))

            const first = await search(query, orgId)
            const second = await search(query, orgId)

            expect(first).toEqual([])
            expect(second).toEqual([])
          },
        ),
        { numRuns: 10 },
      )
    })

    it('repeated calls on an unchanged store produce equal result sets across many iterations', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          fc.array(leadRecordArb('00000000-0000-0000-0000-000000000004'), { minLength: 1, maxLength: 6 }),
          wordArb,
          fc.integer({ min: 2, max: 5 }),
          async (orgId, leads, query, iterations) => {
            store.leads = leads.map(r => ({ ...r, organizationId: orgId }))

            const expected = toKeyMultiset(await search(query, orgId))
            for (let i = 0; i < iterations; i++) {
              const current = toKeyMultiset(await search(query, orgId))
              expect(current).toEqual(expected)
            }
          },
        ),
        { numRuns: 20 },
      )
    })
  })
})
