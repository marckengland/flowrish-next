import { describe, expect, it } from 'vitest'
import { callbackCalendarFromSettings, resolveCallbackTime, validateCallbackInstant, type CallbackCalendar } from './callback-time'

const calendar: CallbackCalendar = { timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5], version: '2026-01-01T00:00:00.000Z' }
const now = new Date('2030-01-01T00:00:00.000Z')
const input = (localTime: string, hours = calendar) => ({ localTime, timeZone: hours.timeZone, businessVersion: hours.version })

describe('requested callback times', () => {
  it('preserves the local readback, timezone and settings version with the canonical UTC instant', () => {
    expect(resolveCallbackTime(input('2030-01-07T09:30'), calendar, now)).toEqual({ at: '2030-01-07T01:30:00.000Z', localTime: '2030-01-07T09:30', timeZone: 'Asia/Manila', businessVersion: calendar.version })
    expect(validateCallbackInstant('2030-01-07T01:30:00.000Z', calendar, now).localTime).toBe('2030-01-07T09:30')
  })
  it('allows opening time and rejects closing time, weekends and unavailable hours', () => {
    expect(resolveCallbackTime(input('2030-01-07T09:00'), calendar, now).at).toBe('2030-01-07T01:00:00.000Z')
    for (const value of ['2030-01-07T08:59', '2030-01-07T17:00', '2030-01-05T10:00', '2030-01-06T10:00']) expect(() => resolveCallbackTime(input(value), calendar, now)).toThrow(/business hours/)
  })
  it('rejects invalid calendar dates, past times and dates over 90 days away', () => {
    for (const value of ['2030-02-30T10:00', '2030-01-01T07:00', '2030-05-01T10:00', '2030-13-01T10:00']) expect(() => resolveCallbackTime(input(value), calendar, now)).toThrow()
  })
  it('rejects settings/timezone changes so consent cannot silently change meaning', () => {
    expect(() => resolveCallbackTime({ ...input('2030-01-07T10:00'), businessVersion: '2026-01-02T00:00:00.000Z' }, calendar, now)).toThrow(/changed/)
    expect(() => resolveCallbackTime({ ...input('2030-01-07T10:00'), timeZone: 'UTC' }, calendar, now)).toThrow(/changed/)
  })
  it('handles fractional timezone offsets', () => {
    const hours = { ...calendar, timeZone: 'Asia/Kathmandu' }
    expect(resolveCallbackTime(input('2030-01-07T10:00', hours), hours, now).at).toBe('2030-01-07T04:15:00.000Z')
  })
  it('rejects nonexistent spring-forward and ambiguous fall-back local times', () => {
    const hours = { ...calendar, timeZone: 'America/New_York', businessDays: [0], opensAt: '00:00', closesAt: '05:00' }
    expect(() => resolveCallbackTime(input('2026-03-08T02:30', hours), hours, new Date('2026-03-01T00:00:00Z'))).toThrow(/clock change/)
    expect(() => resolveCallbackTime(input('2026-11-01T01:30', hours), hours, new Date('2026-10-25T00:00:00Z'))).toThrow(/clock change/)
    expect(resolveCallbackTime(input('2026-03-08T03:30', hours), hours, new Date('2026-03-01T00:00:00Z')).at).toBe('2026-03-08T07:30:00.000Z')
  })
  it('rejects staff instants outside the saved schedule or minute precision', () => {
    expect(() => validateCallbackInstant('2030-01-07T09:00:00Z', calendar, now)).toThrow(/business hours/)
    expect(() => validateCallbackInstant('2030-01-07T01:30:05Z', calendar, now)).toThrow(/minute/)
  })
  it('extracts only public weekly hours/version and ignores private settings', () => {
    expect(callbackCalendarFromSettings({ settings: { ...calendar, knowledge: 'private', enabled: false }, updatedAt: new Date(calendar.version) })).toEqual(calendar)
    expect(callbackCalendarFromSettings(null)).toBe(null)
    expect(callbackCalendarFromSettings({ settings: { ...calendar, opensAt: '20:00', closesAt: '08:00' }, updatedAt: new Date(calendar.version) })).toBe(null)
  })
})
