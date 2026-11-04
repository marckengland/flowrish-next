import { describe, expect, it } from 'vitest'
import { savedLeadFiltersSchema, savedLeadViewCreateSchema, savedLeadViewUpdateSchema, unavailableViewFilters } from './saved-lead-views'

const id = '11111111-1111-4111-8111-111111111111'
describe('saved lead view values', () => {
  it('normalizes names and allows only the existing bounded lead filters', () => {
    expect(savedLeadViewCreateSchema.parse({ id, name: '  My   prospects ', filters: { search: '  Acme ', leadStatus: 'NEW', tier: 'TIER_1', stageId: id } })).toEqual({ id, name: 'My prospects', filters: { search: 'Acme', leadStatus: 'NEW', tier: 'TIER_1', stageId: id } })
    for (const filters of [{ organizationId: id }, { userId: id }, { stageId: 'bad' }, { leadStatus: 'anything' }, { search: 'x'.repeat(201) }, { tier: 'HIGH' }, null, []]) expect(savedLeadFiltersSchema.safeParse(filters).success).toBe(false)
    for (const name of ['', 'x'.repeat(81), 'Bad\u0000name']) expect(savedLeadViewCreateSchema.safeParse({ id, name, filters: {} }).success).toBe(false)
    expect(savedLeadViewCreateSchema.safeParse({ id, name: 'Valid', filters: {}, userId: id }).success).toBe(false)
  })
  it('requires a revision and at least one explicitly editable field', () => {
    expect(savedLeadViewUpdateSchema.safeParse({ expectedRevision: 1 }).success).toBe(false)
    expect(savedLeadViewUpdateSchema.safeParse({ name: 'Rename' }).success).toBe(false)
    expect(savedLeadViewUpdateSchema.safeParse({ expectedRevision: 1, name: 'Rename', revision: 99 }).success).toBe(false)
    expect(savedLeadViewUpdateSchema.parse({ expectedRevision: 2, filters: {} })).toEqual({ expectedRevision: 2, filters: {} })
  })
  it('refuses missing filter references instead of silently widening a saved view', () => {
    expect(unavailableViewFilters({ stageId: id, assignedUserId: id }, { stages: [], assignees: [], pipelineId: id })).toEqual(['stage', 'assignee'])
    expect(unavailableViewFilters({ pipelineId: id }, { stages: [], assignees: [], pipelineId: 'other' })).toEqual(['pipeline'])
    expect(unavailableViewFilters({ stageId: id, assignedUserId: id }, { stages: [{ value: id }], assignees: [{ value: id }], pipelineId: id })).toEqual([])
  })
})
