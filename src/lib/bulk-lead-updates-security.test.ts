import { describe, expect, it } from 'vitest'
import { BULK_LEAD_LIMIT, bulkLeadSelection } from './bulk-lead-updates'

describe('bulk lead validation resource bounds', () => {
  it('rejects an oversized selection before inspecting its records', () => {
    let inspected = 0
    const rows = Array.from({ length: BULK_LEAD_LIMIT + 1 }, () => ({
      get id() {
        inspected += 1
        return '00000000-0000-4000-8000-000000000001'
      },
      expectedUpdatedAt: '2026-11-18T00:00:00.000Z',
    }))

    const result = bulkLeadSelection.safeParse(rows)

    expect(result.success).toBe(false)
    if (result.success) throw new Error('Oversized selection was accepted')
    expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'too_big', maximum: BULK_LEAD_LIMIT }),
    ]))
    expect(inspected).toBe(0)
  })

  it('retains the accepted selection and normalized version', () => {
    const row = {
      id: '00000000-0000-4000-8000-000000000001',
      expectedUpdatedAt: '2026-11-18T00:00:00Z',
    }

    expect(bulkLeadSelection.parse([row])).toEqual([
      { ...row, expectedUpdatedAt: '2026-11-18T00:00:00.000Z' },
    ])
  })
})
