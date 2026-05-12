import { describe, expect, it } from 'vitest'

import { buildLeadsQueryString } from './use-leads'

/**
 * Unit tests for the `useLeadsQuery` helpers. The query string builder is
 * pure, so we test it directly. Hook behavior relies on TanStack Query
 * which is exercised end-to-end by the Providers tests already.
 *
 * Validates: Requirements 4.4, 4.6
 */
describe('buildLeadsQueryString', () => {
  it('returns empty string when no filters or pagination are set', () => {
    expect(buildLeadsQueryString({ filters: {} })).toBe('')
  })

  it('includes page and pageSize when provided', () => {
    const qs = buildLeadsQueryString({
      filters: {},
      page: 2,
      pageSize: 50,
    })
    expect(qs).toContain('page=2')
    expect(qs).toContain('pageSize=50')
    expect(qs.startsWith('?')).toBe(true)
  })

  it('includes filter values', () => {
    const qs = buildLeadsQueryString({
      filters: {
        stageId: 'stage-1',
        leadStatus: 'NEW',
        tier: 'TIER_1',
        search: 'acme',
        assignedUserId: 'user-7',
      },
    })
    expect(qs).toContain('stageId=stage-1')
    expect(qs).toContain('leadStatus=NEW')
    expect(qs).toContain('tier=TIER_1')
    expect(qs).toContain('search=acme')
    expect(qs).toContain('assignedUserId=user-7')
  })

  it('omits undefined, null, and empty-string filter values', () => {
    const qs = buildLeadsQueryString({
      filters: {
        stageId: undefined,
        leadStatus: '',
        search: 'acme',
      } as never,
    })
    expect(qs).toBe('?search=acme')
  })
})
