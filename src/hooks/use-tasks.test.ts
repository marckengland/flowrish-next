import { describe, expect, it } from 'vitest'

import { buildTasksQueryString, tasksKeys } from './use-tasks'

/**
 * Unit tests for the pure helpers in `use-tasks`. Covers the querystring
 * builder and the cache key factory so any drift in filter shape is
 * caught before it reaches production.
 *
 * Validates: Requirements 18.1, 18.4, 18.5
 */

describe('buildTasksQueryString', () => {
  it('returns an empty string when no filters are set', () => {
    expect(buildTasksQueryString({})).toBe('')
  })

  it('includes only filters with values (omits undefined)', () => {
    const qs = buildTasksQueryString({
      leadId: 'lead-1',
      priority: 'HIGH',
    })
    const params = new URLSearchParams(qs.replace(/^\?/, ''))
    expect(params.get('leadId')).toBe('lead-1')
    expect(params.get('priority')).toBe('HIGH')
    expect(params.has('assigneeId')).toBe(false)
    expect(params.has('isComplete')).toBe(false)
  })

  it('serialises isComplete=false so completed-task filters round-trip', () => {
    const qs = buildTasksQueryString({ isComplete: false })
    const params = new URLSearchParams(qs.replace(/^\?/, ''))
    expect(params.get('isComplete')).toBe('false')
  })

  it('serialises isComplete=true', () => {
    const qs = buildTasksQueryString({ isComplete: true })
    const params = new URLSearchParams(qs.replace(/^\?/, ''))
    expect(params.get('isComplete')).toBe('true')
  })

  it('prefixes the querystring with "?" when at least one filter is set', () => {
    expect(buildTasksQueryString({ assigneeId: 'user-1' }).startsWith('?')).toBe(
      true,
    )
  })
})

describe('tasksKeys', () => {
  it('produces a stable key for identical filter shapes', () => {
    const a = tasksKeys.list({ assigneeId: 'user-1', priority: 'HIGH' })
    const b = tasksKeys.list({ assigneeId: 'user-1', priority: 'HIGH' })
    expect(a).toEqual(b)
  })

  it('includes the "tasks" namespace in the key', () => {
    const key = tasksKeys.list({})
    expect(key[0]).toBe('tasks')
    expect(key[1]).toBe('list')
  })

  it('differentiates between filter shapes', () => {
    const a = tasksKeys.list({ assigneeId: 'user-1' })
    const b = tasksKeys.list({ assigneeId: 'user-2' })
    expect(a).not.toEqual(b)
  })
})
