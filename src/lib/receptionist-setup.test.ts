import { describe, expect, it } from 'vitest'
import { setupBusinessWriteSchema, setupLaunchSchema, businessHoursTemplate } from './receptionist-setup'
const values = { businessName: 'Synthetic Repairs', timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5] }
describe('guided receptionist setup contracts', () => {
  it('accepts only the business subset and a saved-version expectation', () => {
    expect(setupBusinessWriteSchema.safeParse({ values, expectedUpdatedAt: null }).success).toBe(true)
    expect(setupBusinessWriteSchema.safeParse({ values: { ...values, enabled: true }, expectedUpdatedAt: null }).success).toBe(false)
    expect(setupBusinessWriteSchema.safeParse({ values: { ...values, businessDays: [1, 1] }, expectedUpdatedAt: null }).success).toBe(false)
    expect(setupBusinessWriteSchema.safeParse({ values: { ...values, opensAt: '18:00' }, expectedUpdatedAt: null }).success).toBe(false)
  })
  it('requires both explicit simulation review and spending acknowledgement for launch', () => {
    const input = { expectedVersion: 'a'.repeat(64), simulationReviewed: true, acknowledged: true }
    expect(setupLaunchSchema.safeParse(input).success).toBe(true)
    expect(setupLaunchSchema.safeParse({ ...input, acknowledged: false }).success).toBe(false)
    expect(setupLaunchSchema.safeParse({ ...input, simulationReviewed: false }).success).toBe(false)
  })
  it('uses saved business hours to suggest a draft without inventing service or pricing facts', () => {
    const template = businessHoursTemplate(values)
    expect(template.contentText).toContain('Asia/Manila'); expect(template.contentText).toContain('09:00–17:00'); expect(template.category).toBe('GENERAL'); expect(template.contentText).not.toContain('price'); expect(template.contentText.split('\n')).toHaveLength(10)
  })
})
