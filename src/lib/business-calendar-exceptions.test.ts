import { describe, expect, it } from 'vitest'
import { businessCalendar, businessHoursSchema, type BusinessHours } from './callback-response'
import { callbackCalendarFromSettings, resolveCallbackTime } from './callback-time'
import { isBusinessOpen, nextBusinessOpening, receptionistConfigSchema } from './receptionist'
import { demoHours } from './receptionist-demo'
import { businessHoursTemplate, setupBusinessSchema } from './receptionist-setup'

const hours = { timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5] }
const closed = { date: '2026-11-09', closed: true as const }
const reduced = { date: '2026-11-09', closed: false as const, opensAt: '09:00', closesAt: '12:00' }
const now = new Date('2026-11-03T00:00:00.000Z'), version = now.toISOString()
const config = { ...hours, enabled: false, businessName: 'Sample Business', knowledge: '', mode: 'always' as const, forwardTo: '', assigneeId: '', stageId: '' }
const calendar = (calendarExceptions: object[]) => ({ ...hours, calendarExceptions }) as BusinessHours
const request = (localTime: string, value: BusinessHours) => resolveCallbackTime({ localTime, timeZone: value.timeZone, businessVersion: version }, { ...value, version }, now)

describe('date-specific business calendar rules', () => {
  it('accepts bounded explicit exceptions through business, setup, receptionist and safe public contracts', () => {
    const value = { ...hours, calendarExceptions: [closed, { ...reduced, date: '2026-11-10' }] }
    expect(businessHoursSchema.parse(value)).toEqual(value)
    expect(setupBusinessSchema.parse({ businessName: 'Sample Business', ...value })).toEqual({ businessName: 'Sample Business', ...value })
    expect(receptionistConfigSchema.parse({ ...config, ...value })).toMatchObject(value)
    expect(callbackCalendarFromSettings({ settings: { ...config, ...value, knowledge: 'PRIVATE NOTES' }, updatedAt: now })).toEqual({ ...value, version })
    expect(businessHoursSchema.parse(hours)).toEqual(hours)
  })
  it('rejects impossible, duplicate, oversized, overnight and contradictory exceptions', () => {
    for (const calendarExceptions of [
      [{ ...closed, date: '2026-02-30' }], [closed, closed], [{ ...closed, date: '1999-12-31' }],
      [{ ...closed, opensAt: '09:00' }], [{ ...reduced, closesAt: '08:00' }], [{ date: closed.date, closed: false }],
      Array.from({ length: 101 }, (_, index) => ({ ...closed, date: new Date(Date.UTC(2027, 0, index + 1)).toISOString().slice(0, 10) })),
    ]) expect(businessHoursSchema.safeParse({ ...hours, calendarExceptions }).success).toBe(false)
  })
  it('skips a closed weekday when calculating response business minutes', () => {
    expect(businessCalendar(calendar([closed]))(new Date('2026-11-09T01:00:00Z'), 60).toISOString()).toBe('2026-11-10T02:00:00.000Z')
  })
  it('uses shorter hours and resumes the remaining response minutes on the next opening', () => {
    expect(businessCalendar(calendar([reduced]))(new Date('2026-11-09T03:30:00Z'), 60).toISOString()).toBe('2026-11-10T01:30:00.000Z')
  })
  it('opens an otherwise closed weekend and keeps closing exclusive for callback requests', () => {
    const value = calendar([{ date: '2026-11-07', closed: false, opensAt: '10:00', closesAt: '12:00' }])
    expect(request('2026-11-07T10:00', value).at).toBe('2026-11-07T02:00:00.000Z')
    expect(() => request('2026-11-07T12:00', value)).toThrow(/business hours/)
    expect(businessCalendar(value)(new Date('2026-11-07T03:30:00Z'), 60).toISOString()).toBe('2026-11-09T01:30:00.000Z')
  })
  it('validates the business-local date rather than the UTC or device date', () => {
    const value = { ...calendar([{ ...reduced, opensAt: '00:00', closesAt: '02:00' }]), opensAt: '09:00', closesAt: '17:00' }
    expect(request('2026-11-09T00:30', value).at).toBe('2026-11-08T16:30:00.000Z')
    expect(() => request('2026-11-09T10:00', calendar([closed]))).toThrow(/business hours/)
  })
  it('counts both elapsed hours in an overridden DST fold but rejects ambiguous preferred times', () => {
    const value = { ...calendar([{ date: '2026-11-01', closed: false, opensAt: '01:00', closesAt: '02:00' }]), timeZone: 'America/New_York' }
    expect(businessCalendar(value)(new Date('2026-11-01T05:00:00Z'), 120).toISOString()).toBe('2026-11-01T07:00:00.000Z')
    expect(() => resolveCallbackTime({ localTime: '2026-11-01T01:30', timeZone: value.timeZone, businessVersion: version }, { ...value, version }, new Date('2026-10-30T00:00:00Z'))).toThrow(/ambiguous/)
  })
  it('calculates a small weekly target across 100 successive closed opening dates', () => {
    const calendarExceptions = Array.from({ length: 100 }, (_, index) => ({ date: new Date(Date.UTC(2026, 10, 9 + index * 7)).toISOString().slice(0, 10), closed: true }))
    const value = { ...calendar(calendarExceptions), businessDays: [1], closesAt: '09:01' }
    expect(businessCalendar(value)(new Date('2026-11-09T01:00:00Z'), 5).toISOString()).toBe(new Date(Date.UTC(2026, 10, 9 + 104 * 7, 1, 1)).toISOString())
  })
  it('uses exceptions for phone opening checks and the next opening without requiring Twilio', () => {
    const value = receptionistConfigSchema.parse({ ...config, calendarExceptions: [closed, { ...reduced, date: '2026-11-10', opensAt: '11:00' }] })
    expect(isBusinessOpen(value, new Date('2026-11-09T02:00:00Z'))).toBe(false)
    expect(nextBusinessOpening(value, new Date('2026-11-09T02:00:00Z')).toISOString()).toBe('2026-11-10T03:00:00.000Z')
    expect(businessHoursTemplate({ ...hours, businessName: 'Sample Business', calendarExceptions: [closed] }).contentText).toContain('2026-11-09: Closed')
    expect(demoHours(value)).toContain('2026-11-09: Closed')
  })
})
