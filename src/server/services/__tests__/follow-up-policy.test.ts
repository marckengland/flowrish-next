import {afterEach,expect,it,vi} from 'vitest'
import {followUpWritesEnabled} from '../follow-up-policy'
afterEach(()=>vi.unstubAllEnvs())
it('keeps normal follow-up writes enabled unless explicitly paused',()=>{vi.stubEnv('FLOWRISH_FOLLOW_UP_WRITES_PAUSED',undefined);expect(followUpWritesEnabled()).toBe(true);vi.stubEnv('FLOWRISH_FOLLOW_UP_WRITES_PAUSED','false');expect(followUpWritesEnabled()).toBe(true)})
it('pauses follow-up and manual-send writes for recovery without changing stored evidence',()=>{vi.stubEnv('FLOWRISH_FOLLOW_UP_WRITES_PAUSED','true');expect(followUpWritesEnabled()).toBe(false)})
