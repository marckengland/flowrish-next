import {expect,it} from 'vitest'
import {needsCheckingEntry} from './needs-checking-entry'
it.each(['PENDING','APPROVED','DISMISSED','SNOOZED'] as const)('accepts the exact summary tab %s',status=>expect(needsCheckingEntry({needsChecking:'1',status})).toBe(status))
it('defaults a valid private filter to Pending',()=>expect(needsCheckingEntry({needsChecking:'1'})).toBe('PENDING'))
it.each([{}, {needsChecking:'0'}, {needsChecking:'true'}, {needsChecking:['1','1']}, {needsChecking:'1',status:['PENDING','APPROVED']}, {needsChecking:'1',status:'OTHER'}, {needsChecking:'1',status:'PENDING',reply:'reply'}, {needsChecking:'1',match:'match'}])('does not activate an invalid, repeated or notification-mixed entry %j',query=>expect(needsCheckingEntry(query)).toBeUndefined())
