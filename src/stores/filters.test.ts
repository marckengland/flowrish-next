import { beforeEach, describe, expect, it } from 'vitest'

import { useFiltersStore } from './filters'

/**
 * Unit tests for the Zustand filters store (leads filter slice).
 *
 * Validates: Requirements 4.4, 4.6, 26.4, 26.5
 */
describe('useFiltersStore (leads)', () => {
  beforeEach(() => {
    useFiltersStore.setState({ leads: {} })
  })

  it('defaults to an empty leads filter slice', () => {
    expect(useFiltersStore.getState().leads).toEqual({})
  })

  it('setLeadFilter stores a value', () => {
    useFiltersStore.getState().setLeadFilter('stageId', 'stage-1')
    expect(useFiltersStore.getState().leads).toEqual({ stageId: 'stage-1' })
  })

  it('setLeadFilter trims whitespace and drops empty strings', () => {
    useFiltersStore.getState().setLeadFilter('search', '   ')
    expect(useFiltersStore.getState().leads.search).toBeUndefined()

    useFiltersStore.getState().setLeadFilter('search', '  acme  ')
    expect(useFiltersStore.getState().leads.search).toBe('acme')
  })

  it('setLeadFilter removes a key when passed empty/nullish values', () => {
    useFiltersStore.getState().setLeadFilter('stageId', 'stage-1')
    expect(useFiltersStore.getState().leads.stageId).toBe('stage-1')

    useFiltersStore.getState().setLeadFilter('stageId', '')
    expect(useFiltersStore.getState().leads.stageId).toBeUndefined()
    expect('stageId' in useFiltersStore.getState().leads).toBe(false)

    useFiltersStore.getState().setLeadFilter('stageId', 'stage-2')
    useFiltersStore.getState().setLeadFilter('stageId', null)
    expect('stageId' in useFiltersStore.getState().leads).toBe(false)
  })

  it('multiple filters coexist independently', () => {
    const { setLeadFilter } = useFiltersStore.getState()
    setLeadFilter('stageId', 'stage-1')
    setLeadFilter('leadStatus', 'NEW')
    setLeadFilter('tier', 'TIER_1')

    expect(useFiltersStore.getState().leads).toEqual({
      stageId: 'stage-1',
      leadStatus: 'NEW',
      tier: 'TIER_1',
    })
  })

  it('setLeadFilters replaces the whole slice and normalizes values', () => {
    useFiltersStore.getState().setLeadFilter('stageId', 'stage-1')
    useFiltersStore.getState().setLeadFilters({
      leadStatus: 'NEW',
      search: '  ',
      tier: 'TIER_2',
    })
    expect(useFiltersStore.getState().leads).toEqual({
      leadStatus: 'NEW',
      tier: 'TIER_2',
    })
    expect('stageId' in useFiltersStore.getState().leads).toBe(false)
  })

  it('resetLeadFilters clears the slice', () => {
    useFiltersStore.getState().setLeadFilters({
      stageId: 'stage-1',
      leadStatus: 'NEW',
    })
    useFiltersStore.getState().resetLeadFilters()
    expect(useFiltersStore.getState().leads).toEqual({})
  })
})
