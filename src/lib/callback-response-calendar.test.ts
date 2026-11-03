import { describe, expect, it } from 'vitest'
import { businessCalendar, businessHoursSchema } from './callback-response'
const hours = { timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5] }
describe('business-calendar response deadlines', () => {
  it('counts only opening time, carries weekends and preserves source seconds', () => {
    const deadline = businessCalendar(hours)
    expect(deadline(new Date('2026-11-06T08:30:00.123Z'), 60).toISOString()).toBe('2026-11-09T01:30:00.123Z')
    expect(deadline(new Date('2026-11-06T09:00:00Z'), 30).toISOString()).toBe('2026-11-09T01:30:00.000Z')
    expect(deadline(new Date('2026-11-07T04:00:00Z'), 60).toISOString()).toBe('2026-11-09T02:00:00.000Z')
    expect(deadline(new Date('2026-11-06T00:00:00Z'), 60).toISOString()).toBe('2026-11-06T02:00:00.000Z')
  })
  it('uses each date’s timezone offset across seasonal changes', () => {
    const deadline = businessCalendar({ ...hours, timeZone: 'America/New_York' })
    expect(deadline(new Date('2026-03-06T21:30:00Z'), 60).toISOString()).toBe('2026-03-09T13:30:00.000Z')
    expect(deadline(new Date('2026-10-30T20:30:00Z'), 60).toISOString()).toBe('2026-11-02T14:30:00.000Z')
  })
  it('excludes nonexistent DST minutes and counts repeated local windows separately', () => {
    const sunday = { timeZone: 'America/New_York', opensAt: '01:30', closesAt: '03:30', businessDays: [0] }
    expect(businessCalendar(sunday)(new Date('2026-03-08T06:30:00Z'), 60).toISOString()).toBe('2026-03-08T07:30:00.000Z')
    expect(businessCalendar({ ...sunday, closesAt: '01:45' })(new Date('2026-11-01T05:30:00Z'), 20).toISOString()).toBe('2026-11-01T06:35:00.000Z')
    expect(businessCalendar({ ...sunday, opensAt: '02:00', closesAt: '02:30' })(new Date('2026-03-08T00:00:00Z'), 15).toISOString()).toBe('2026-03-15T06:15:00.000Z')
  })
  it('supports fractional-hour offsets and half-hour DST transitions', () => {
    expect(businessCalendar({ ...hours, timeZone: 'Asia/Kathmandu' })(new Date('2026-11-02T00:00:00Z'), 60).toISOString()).toBe('2026-11-02T04:15:00.000Z')
    expect(businessCalendar({ timeZone: 'Australia/Lord_Howe', opensAt: '01:30', closesAt: '03:00', businessDays: [0] })(new Date('2026-10-03T15:00:00Z'), 60).toISOString()).toBe('2026-10-03T16:00:00.000Z')
  })
  it('rejects invalid, duplicate, overnight and impractically sparse schedules', () => {
    expect(businessHoursSchema.safeParse({ ...hours, businessDays: [1, 1] }).success).toBe(false)
    expect(businessHoursSchema.safeParse({ ...hours, opensAt: '20:00' }).success).toBe(false)
    expect(() => businessCalendar({ ...hours, timeZone: 'Invalid/Zone' })).toThrow()
    expect(() => businessCalendar({ ...hours, opensAt: '09:00', closesAt: '09:01', businessDays: [1] })(new Date(), 60)).toThrow()
    expect(() => businessCalendar(hours)(new Date('bad'), 60)).toThrow()
  })
})
