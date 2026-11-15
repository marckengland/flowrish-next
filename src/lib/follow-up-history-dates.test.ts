import {expect,it} from 'vitest'
import {historyPresetRange,resolveHistoryDateRange} from './follow-up-history-dates'
it('includes both Manila calendar dates using an exclusive next-local-day boundary',()=>{
 expect(resolveHistoryDateRange({from:'2026-11-01',to:'2026-11-02',timeZone:'Asia/Manila'})).toEqual({from:'2026-11-01',to:'2026-11-02',timeZone:'Asia/Manila',start:'2026-10-31T16:00:00.000Z',end:'2026-11-02T16:00:00.000Z'})
})
it.each([['2026-03-08',23],['2026-11-01',25]] as const)('uses the actual %s New York calendar day across a clock change', (day,hours)=>{
 const value=resolveHistoryDateRange({from:day,to:day,timeZone:'America/New_York'});expect(Date.parse(value.end)-Date.parse(value.start)).toBe(hours*3600000)
})
it('handles fractional offsets and real leap days without the host timezone',()=>{
 expect(resolveHistoryDateRange({from:'2028-02-29',to:'2028-02-29',timeZone:'Asia/Kathmandu'})).toMatchObject({start:'2028-02-28T18:15:00.000Z',end:'2028-02-29T18:15:00.000Z'})
})
it('rejects incomplete, impossible, reversed, out-of-policy or unavailable date boundaries',()=>{
 for(const value of [{from:'2026-02-29',to:'2026-03-01',timeZone:'UTC'},{from:'2026-11-02',to:'2026-11-01',timeZone:'UTC'},{from:'2026-11-01',to:'2026-11-02',timeZone:'Invalid/Zone'},{from:'1999-12-31',to:'2000-01-01',timeZone:'UTC'},{from:'2026-11-01',timeZone:'UTC'},{from:'2011-12-30',to:'2011-12-30',timeZone:'Pacific/Apia'},{from:'2026-11-01',to:'2026-11-01',timeZone:'America/Havana'}])expect(()=>resolveHistoryDateRange(value)).toThrow()
})
it('freezes relative presets to inclusive local calendar dates and recomputes only when called',()=>{
 const before=historyPresetRange(7,'Asia/Manila',new Date('2026-11-15T15:59:00.000Z')),after=historyPresetRange(7,'Asia/Manila',new Date('2026-11-15T16:01:00.000Z'))
 expect(before).toMatchObject({from:'2026-11-09',to:'2026-11-15'});expect(after).toMatchObject({from:'2026-11-10',to:'2026-11-16'});expect(before.to).toBe('2026-11-15');expect(historyPresetRange(30,'Asia/Manila',new Date('2026-11-15T16:01:00.000Z'))).toMatchObject({from:'2026-10-18',to:'2026-11-16'})
})
