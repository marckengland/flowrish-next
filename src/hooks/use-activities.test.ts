import { describe, expect, it } from 'vitest'

import { parseAttendees } from './use-activities'

/**
 * Unit tests for the pure helpers in `use-activities`. The query /
 * mutation bindings rely on TanStack Query plumbing already covered by
 * other tests in this suite.
 *
 * Validates: Requirements 5.1, 5.2, 5.4
 */
describe('parseAttendees', () => {
  it('returns an empty array for null', () => {
    expect(parseAttendees(null)).toEqual([])
  })

  it('returns an empty array for undefined', () => {
    expect(parseAttendees(undefined)).toEqual([])
  })

  it('returns an empty array for empty strings', () => {
    expect(parseAttendees('')).toEqual([])
  })

  it('parses a JSON-encoded array of strings', () => {
    expect(parseAttendees('["Jane","John"]')).toEqual(['Jane', 'John'])
  })

  it('filters out non-string entries defensively', () => {
    expect(parseAttendees('["Jane",42,null,"John"]')).toEqual(['Jane', 'John'])
  })

  it('returns an empty array for malformed JSON', () => {
    expect(parseAttendees('not json')).toEqual([])
  })

  it('returns an empty array when the JSON is not an array', () => {
    expect(parseAttendees('{"name":"Jane"}')).toEqual([])
  })
})
