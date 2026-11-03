import { describe, expect, it } from 'vitest'
import { receptionistHomeSchema } from './receptionist-home'
const base = { asOf: '2026-11-03T00:00:00.000Z', businessName: 'Sample Business', canManage: false, canWork: true, readiness: null, counts: { pendingHandoffs: null, openCallbacks: 0, overdueCallbacks: 0, missedHandoffs: null, missedContacts: 0 }, targets: { enabled: false, checkedAt: null } }
describe('receptionist home privacy contract', () => {
  it('accepts an empty staff snapshot without inventing administrator access or private totals', () => {
    expect(receptionistHomeSchema.parse(base)).toEqual(base)
    expect(receptionistHomeSchema.safeParse({ ...base, counts: { ...base.counts, pendingHandoffs: 4 } }).success).toBe(false)
    expect(receptionistHomeSchema.safeParse({ ...base, canWork: false }).success).toBe(false)
  })
  it('rejects impossible counts, unsupported fields and invalid observation dates', () => {
    for (const data of [{ ...base, counts: { ...base.counts, overdueCallbacks: 1 } }, { ...base, counts: { ...base.counts, missedContacts: -1 } }, { ...base, apiKey: 'must never return' }, { ...base, asOf: 'not-a-date' }]) expect(receptionistHomeSchema.safeParse(data).success).toBe(false)
  })
})
