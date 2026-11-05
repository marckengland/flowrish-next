import { expect, it } from 'vitest'
import { resolveLocalMinute } from './callback-time'
it('resolves Manila local minutes without using the host timezone', () => { expect(new Date(resolveLocalMinute('2026-11-06T09:00', 'Asia/Manila')).toISOString()).toBe('2026-11-06T01:00:00.000Z') })
it('rejects nonexistent and repeated daylight-saving minutes', () => { expect(() => resolveLocalMinute('2026-03-08T02:30', 'America/New_York')).toThrow(); expect(() => resolveLocalMinute('2026-11-01T01:30', 'America/New_York')).toThrow() })
it('validates calendar dates and timezone names', () => { expect(() => resolveLocalMinute('2026-02-30T09:00', 'Asia/Manila')).toThrow(); expect(() => resolveLocalMinute('2026-11-06T09:00', 'Invalid/Zone')).toThrow() })
it('keeps unambiguous minutes around a clock change usable', () => { expect(new Date(resolveLocalMinute('2026-11-01T03:00', 'America/New_York')).toISOString()).toBe('2026-11-01T08:00:00.000Z') })
